const mongoose = require('mongoose');

const routeMonitorSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			index: true,
		},
		// Información de la ruta
		name: {
			type: String,
			required: true,
			trim: true,
		},
		origin: {
			type: String,
			required: true,
			uppercase: true,
			trim: true,
		},
		destination: {
			type: String,
			required: true,
			uppercase: true,
			trim: true,
		},

		// Configuración de monitoreo
		priceThreshold: {
			type: Number,
			required: true,
			default: 500, // EUR
		},

		flightType: {
			type: String,
			enum: ['oneway', 'roundtrip'],
			default: 'roundtrip',
		},

		outboundDateRange: {
			startDate: {
				type: String,
				required: true,
			},
			endDate: {
				type: String,
				required: true,
			},
			flexible: {
				type: Boolean,
				default: true,
			},
		},

		inboundDateRange: {
			startDate: {
				type: String,
				required: function () {
					return this.flightType === 'roundtrip';
				},
			},
			endDate: {
				type: String,
				required: function () {
					return this.flightType === 'roundtrip';
				},
			},
			flexible: {
				type: Boolean,
				default: true,
			},
		},

		// Configuración de pasajeros
		passengers: {
			type: Number,
			default: 1,
			min: 1,
			max: 9,
		},

		// Estado del monitoreo
		isActive: {
			type: Boolean,
			default: true,
		},

		// Frecuencia de chequeo (en minutos)
		checkInterval: {
			type: Number,
			default: 30,
			min: 15,
		},

		// Última verificación
		lastChecked: {
			type: Date,
			default: null,
		},

		// Mejor precio encontrado hasta ahora
		bestPrice: {
			amount: Number,
			currency: String,
			flightId: String,
			foundAt: Date,
		},

		// Configuración de notificaciones (heredada del usuario pero puede personalizarse)
		notifications: {
			enabled: {
				type: Boolean,
				default: true,
			},
			telegram: {
				lastSent: Date,
				cooldownMinutes: {
					type: Number,
					default: null,
				},
			},
			onlyNewLows: {
				type: Boolean,
				default: true, // Solo notificar si es más barato que bestPrice
			},
		},

		// Estadísticas
		stats: {
			totalChecks: {
				type: Number,
				default: 0,
			},
			alertsSent: {
				type: Number,
				default: 0,
			},
			averagePrice: Number,
			lowestPrice: Number,
			highestPrice: Number,
		},

		// Tags y notas
		tags: [String],

		// Notas del usuario
		notes: String,
	},
	{
		timestamps: true,
	}
);

// Índices
routeMonitorSchema.index({userId: 1, isActive: 1});
routeMonitorSchema.index({origin: 1, destination: 1});
routeMonitorSchema.index({isActive: 1, lastChecked: 1});
routeMonitorSchema.index({
	'outboundDateRange.startDate': 1,
	'outboundDateRange.endDate': 1,
});

// Middleware para actualizar stats del usuario cuando se crea/actualiza/elimina un monitor
routeMonitorSchema.post('save', async function (doc) {
	try {
		await updateUserStats(doc.userId);
	} catch (error) {
		console.error('❌ Error actualizando stats del usuario:', error);
	}
});

routeMonitorSchema.post('deleteOne', {document: true}, async function (doc) {
	try {
		await updateUserStats(doc.userId);
	} catch (error) {
		console.error(
			'❌ Error actualizando stats del usuario después de eliminar:',
			error
		);
	}
});

// Función helper para actualizar estadísticas del usuario
async function updateUserStats(userId) {
	const User = mongoose.model('User');
	const RouteMonitor = mongoose.model('RouteMonitor');

	const stats = await RouteMonitor.aggregate([
		{$match: {userId: userId}},
		{
			$group: {
				_id: null,
				totalMonitors: {$sum: 1},
				activeMonitors: {
					$sum: {
						$cond: [{$eq: ['$isActive', true]}, 1, 0],
					},
				},
			},
		},
	]);

	const userStats = stats[0] || {totalMonitors: 0, activeMonitors: 0};

	await User.findByIdAndUpdate(userId, {
		'stats.totalMonitors': userStats.totalMonitors,
		'stats.activeMonitors': userStats.activeMonitors,
	});
}

// Método para verificar si es tiempo de chequear
routeMonitorSchema.methods.shouldCheck = function () {
	if (!this.isActive) return false;
	if (!this.lastChecked) return true;

	const now = new Date();
	const timeSinceLastCheck = now - this.lastChecked;
	const intervalMs = this.checkInterval * 60 * 1000;

	return timeSinceLastCheck >= intervalMs;
};

// Método para obtener el usuario asociado
routeMonitorSchema.methods.getUser = async function () {
	await this.populate('userId');
	return this.userId;
};

// Método para obtener configuración de cooldown (usuario o monitor)
routeMonitorSchema.methods.getCooldownMinutes = async function () {
	if (this.notifications.telegram.cooldownMinutes !== null) {
		return this.notifications.telegram.cooldownMinutes;
	}

	// Usar configuración del usuario
	const user = await this.getUser();
	return user.preferences.notifications.cooldownMinutes;
};

// Método para obtener fechas de búsqueda
routeMonitorSchema.methods.getSearchDates = function () {
	const outboundDates = this.generateDateRange(
		this.outboundDateRange.startDate,
		this.outboundDateRange.endDate,
		this.outboundDateRange.flexible
	);

	if (this.flightType === 'oneway') {
		return {outbound: outboundDates, inbound: []};
	}

	const inboundDates = this.generateDateRange(
		this.inboundDateRange.startDate,
		this.inboundDateRange.endDate,
		this.inboundDateRange.flexible
	);

	return {outbound: outboundDates, inbound: inboundDates};
};

// Generar rango de fechas
routeMonitorSchema.methods.generateDateRange = function (
	startDate,
	endDate,
	flexible
) {
	const dates = [];
	const start = new Date(startDate);
	const end = new Date(endDate);

	if (flexible) {
		// Si es flexible, buscar varias fechas en el rango
		const diffTime = Math.abs(end - start);
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
		const step = Math.max(1, Math.floor(diffDays / 3)); // Máximo 3 fechas

		for (let i = 0; i <= diffDays; i += step) {
			const date = new Date(start);
			date.setDate(start.getDate() + i);
			dates.push(date.toISOString().split('T')[0]);

			if (dates.length >= 3) break;
		}
	} else {
		// Si no es flexible, solo las fechas específicas
		if (startDate === endDate) {
			dates.push(startDate);
		} else {
			dates.push(startDate, endDate);
		}
	}

	return dates;
};

// Método para actualizar estadísticas
routeMonitorSchema.methods.updateStats = function (prices) {
	if (!prices || prices.length === 0) {
		console.log('📊 No hay precios para actualizar stats');
		return;
	}

	this.stats.totalChecks += 1;

	// Filtrar y validar precios correctamente
	const amounts = prices
		.map((p) => {
			if (typeof p === 'object' && p.amount) {
				return p.amount;
			}
			if (typeof p === 'number') {
				return p;
			}
			return null;
		})
		.filter((amount) => {
			// Filtrar valores válidos
			return (
				amount !== null &&
				!isNaN(amount) &&
				isFinite(amount) &&
				amount > 0 &&
				amount < 10000
			); // Máximo razonable
		});

	console.log(
		`📊 Precios válidos para stats: ${amounts.length}/${prices.length}`
	);

	if (amounts.length > 0) {
		const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
		const min = Math.min(...amounts);
		const max = Math.max(...amounts);

		// Validar que los cálculos sean números válidos
		if (!isNaN(avg) && isFinite(avg)) {
			this.stats.averagePrice = Math.round(avg * 100) / 100; // Redondear a 2 decimales
		}

		if (!isNaN(min) && isFinite(min)) {
			this.stats.lowestPrice = Math.min(this.stats.lowestPrice || min, min);
		}

		if (!isNaN(max) && isFinite(max)) {
			this.stats.highestPrice = Math.max(this.stats.highestPrice || max, max);
		}

		console.log(
			`📊 Stats actualizados: avg=€${this.stats.averagePrice}, min=€${this.stats.lowestPrice}, max=€${this.stats.highestPrice}`
		);
	} else {
		console.log(
			'📊 No se encontraron precios válidos para actualizar estadísticas'
		);
	}
};

// 🔥 FIX: Método mejorado para verificar si un precio amerita alerta
routeMonitorSchema.methods.shouldAlert = async function (price) {
	if (!this.notifications.enabled) {
		console.log(`🔇 Notificaciones deshabilitadas para ${this.name}`);
		return false;
	}

	if (price.amount > this.priceThreshold) {
		console.log(
			`💰 Precio €${price.amount} supera umbral €${this.priceThreshold} para ${this.name}`
		);
		return false;
	}

	// Verificar si el usuario puede recibir más alertas hoy
	const user = await this.getUser();
	if (!user.canReceiveAlert()) {
		console.log(
			`⚠️ Usuario ${user.firstName} ha alcanzado el límite de alertas diarias`
		);
		return false;
	}

	// Verificar si está en horas silenciosas
	if (user.isInQuietHours()) {
		console.log(`🔇 Usuario ${user.firstName} está en horas silenciosas`);
		return false;
	}

	if (this.notifications.onlyNewLows) {
		if (this.bestPrice && price.amount >= this.bestPrice.amount) {
			console.log(
				`📊 Precio €${price.amount} no es mejor que mejor precio €${this.bestPrice.amount} para ${this.name}`
			);
			return false;
		}
	}

	if (this.notifications.telegram.lastSent) {
		const cooldownMinutes = await this.getCooldownMinutes();
		const timeSinceLastAlert =
			new Date() - this.notifications.telegram.lastSent;
		const cooldownMs = cooldownMinutes * 60 * 1000;

		if (timeSinceLastAlert < cooldownMs) {
			const remainingMinutes = Math.ceil(
				(cooldownMs - timeSinceLastAlert) / (60 * 1000)
			);
			console.log(
				`⏰ Monitor ${this.name} en cooldown. Faltan ${remainingMinutes} minutos`
			);
			return false;
		}
	}

	console.log(
		`✅ Alerta autorizada para ${this.name}: €${price.amount} (Usuario: ${user.firstName})`
	);
	return true;
};

module.exports = mongoose.model('RouteMonitor', routeMonitorSchema);
