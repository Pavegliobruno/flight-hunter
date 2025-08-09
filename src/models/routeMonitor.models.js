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

		// Fechas a monitorear
		dateRange: {
			startDate: {
				type: String, // Formato: "2024-12-01"
				required: true,
			},
			endDate: {
				type: String, // Formato: "2024-12-31"
				required: true,
			},
			flexible: {
				type: Boolean,
				default: true, // Si puede buscar ±3 días
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
			min: 15, // Mínimo 15 minutos para no saturar la API
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
				chatId: String, // Si es específico para esta ruta
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

		// Tags para organización
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
routeMonitorSchema.index({'dateRange.startDate': 1, 'dateRange.endDate': 1});

// Método para verificar si es tiempo de chequear
routeMonitorSchema.methods.shouldCheck = function () {
	if (!this.isActive) return false;
	if (!this.lastChecked) return true;

	const now = new Date();
	const timeSinceLastCheck = now - this.lastChecked;
	const intervalMs = this.checkInterval * 60 * 1000;

	return timeSinceLastCheck >= intervalMs;
};

// Método para actualizar estadísticas
routeMonitorSchema.methods.updateStats = function (prices) {
	if (!prices || prices.length === 0) return;

	this.stats.totalChecks += 1;

	const amounts = prices.map((p) => p.amount).filter((a) => a > 0);
	if (amounts.length > 0) {
		const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
		const min = Math.min(...amounts);
		const max = Math.max(...amounts);

		this.stats.averagePrice = avg;
		this.stats.lowestPrice = Math.min(this.stats.lowestPrice || min, min);
		this.stats.highestPrice = Math.max(this.stats.highestPrice || max, max);
	}
};

// Método para verificar si un precio amerita alerta
routeMonitorSchema.methods.shouldAlert = function (price) {
	if (!this.notifications.enabled) return false;
	if (price.amount > this.priceThreshold) return false;

	// Si solo queremos nuevos mínimos
	if (
		this.notifications.onlyNewLows &&
		this.bestPrice &&
		price.amount >= this.bestPrice.amount
	) {
		return false;
	}

	// Verificar cooldown
	if (this.notifications.telegram.lastSent) {
		const timeSinceLastAlert =
			new Date() - this.notifications.telegram.lastSent;
		const cooldownMs = this.notifications.telegram.cooldownMinutes * 60 * 1000;
		if (timeSinceLastAlert < cooldownMs) return false;
	}

	return true;
};

module.exports = mongoose.model('RouteMonitor', routeMonitorSchema);
