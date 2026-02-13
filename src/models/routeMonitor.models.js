const mongoose = require('mongoose');

const routeMonitorSchema = new mongoose.Schema(
	{
		// Información de la ruta
		name: {
			type: String,
			required: true,
			trim: true,
		},
		origin: {
			type: String,
			required: true,
			trim: true,
		},
		destination: {
			type: String,
			required: true,
			trim: true,
		},

		// Configuración de monitoreo
		priceThreshold: {
			type: Number,
			required: true,
			default: 500,
		},

		currency: {
			type: String,
			enum: ['EUR', 'USD'],
			default: 'EUR',
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

		maxStops: {
			type: Number,
			min: 0,
			max: 5,
			default: null,
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

		// Configuración de notificaciones
		notifications: {
			enabled: {
				type: Boolean,
				default: true,
			},
			telegram: {
				chatId: String,
				lastSent: Date,
				cooldownMinutes: {
					type: Number,
					default: 60, // No enviar más de 1 alerta por hora del mismo vuelo
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
routeMonitorSchema.index({origin: 1, destination: 1});
routeMonitorSchema.index({isActive: 1, lastChecked: 1});
routeMonitorSchema.index({
	'outboundDateRange.startDate': 1,
	'outboundDateRange.endDate': 1,
});

// Método para generar filtros de la API de Kiwi
routeMonitorSchema.methods.generateKiwiApiFilters = function () {
	const filters = {
		allowReturnFromDifferentCity: false,
		allowChangeInboundDestination: true,
		allowChangeInboundSource: true,
		allowDifferentStationConnection: false,
		enableSelfTransfer: true,
		enableThrowAwayTicketing: true,
		enableTrueHiddenCity: true,
		transportTypes: ['FLIGHT'],
		contentProviders: ['KIWI', 'FRESH'],
		flightsApiLimit: 25,
		limit: 20,
	};

	// Agregar filtro de precio máximo
	if (this.priceThreshold) {
		filters.price = {end: this.priceThreshold};
	}

	// Agregar filtro de escalas máximas
	if (this.maxStops !== null && this.maxStops !== undefined) {
		filters.maxStopsCount = this.maxStops;
	}

	return filters;
};

// Método para verificar si es tiempo de chequear
routeMonitorSchema.methods.shouldCheck = function () {
	if (!this.isActive) return false;
	if (!this.lastChecked) return true;

	const now = new Date();
	const timeSinceLastCheck = now - this.lastChecked;
	const intervalMs = this.checkInterval * 60 * 1000;

	return timeSinceLastCheck >= intervalMs;
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
			return (
				amount !== null &&
				!isNaN(amount) &&
				isFinite(amount) &&
				amount > 0 &&
				amount < 10000
			);
		});

	console.log(
		`📊 Precios válidos para stats: ${amounts.length}/${prices.length}`
	);

	// Reconstruir stats completo para evitar problemas de Mongoose con subdocumentos
	const currentStats = this.stats.toObject ? this.stats.toObject() : {...this.stats};
	const newStats = {
		totalChecks: (currentStats.totalChecks || 0) + 1,
		alertsSent: currentStats.alertsSent || 0,
	};

	if (amounts.length > 0) {
		const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
		const min = Math.min(...amounts);
		const max = Math.max(...amounts);

		newStats.averagePrice = Math.round(avg * 100) / 100;

		// Para lowestPrice, comparar con el valor anterior solo si es válido
		const prevLowest = currentStats.lowestPrice;
		if (prevLowest && isFinite(prevLowest) && prevLowest > 0 && prevLowest < 10000) {
			newStats.lowestPrice = Math.min(prevLowest, min);
		} else {
			newStats.lowestPrice = min;
		}

		// Para highestPrice, comparar con el valor anterior solo si es válido
		const prevHighest = currentStats.highestPrice;
		if (prevHighest && isFinite(prevHighest) && prevHighest > 0 && prevHighest < 10000) {
			newStats.highestPrice = Math.max(prevHighest, max);
		} else {
			newStats.highestPrice = max;
		}

		console.log(
			`📊 Stats actualizados: avg=€${newStats.averagePrice}, min=€${newStats.lowestPrice}, max=€${newStats.highestPrice}`
		);
	} else {
		// Mantener los valores anteriores si son válidos
		if (currentStats.averagePrice && isFinite(currentStats.averagePrice) && currentStats.averagePrice < 10000) {
			newStats.averagePrice = currentStats.averagePrice;
		}
		if (currentStats.lowestPrice && isFinite(currentStats.lowestPrice) && currentStats.lowestPrice < 10000) {
			newStats.lowestPrice = currentStats.lowestPrice;
		}
		if (currentStats.highestPrice && isFinite(currentStats.highestPrice) && currentStats.highestPrice < 10000) {
			newStats.highestPrice = currentStats.highestPrice;
		}
		console.log('📊 No se encontraron precios válidos para actualizar estadísticas');
	}

	// Reemplazar el objeto stats completo para que Mongoose lo detecte
	this.set('stats', newStats);
	this.markModified('stats');
};

// Método para verificar si un precio amerita alerta
routeMonitorSchema.methods.shouldAlert = function (flight) {
	if (!this.notifications.enabled) return false;

	// Soportar tanto objeto flight ({price: {amount}}) como precio directo ({amount})
	const amount = flight.price?.amount ?? flight.amount;
	if (!amount || amount > this.priceThreshold) return false;

	if (
		this.notifications.onlyNewLows &&
		this.bestPrice &&
		amount >= this.bestPrice.amount
	) {
		return false;
	}

	if (this.notifications.telegram.lastSent) {
		const timeSinceLastAlert =
			new Date() - this.notifications.telegram.lastSent;
		const cooldownMs = this.notifications.telegram.cooldownMinutes * 60 * 1000;
		if (timeSinceLastAlert < cooldownMs) return false;
	}

	return true;
};

module.exports = mongoose.model('RouteMonitor', routeMonitorSchema);
