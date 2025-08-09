const mongoose = require('mongoose');

const flightSchema = new mongoose.Schema(
	{
		// Información básica del vuelo
		id: {
			type: String,
			required: true,
			unique: true,
		},
		price: {
			amount: Number,
			currency: String,
		},

		// Origen y destino
		origin: {
			city: String,
			airport: String,
			code: String,
		},
		destination: {
			city: String,
			airport: String,
			code: String,
		},

		// Fechas y tiempos
		departure: {
			date: Date,
			time: String,
			timestamp: Number,
		},
		arrival: {
			date: Date,
			time: String,
			timestamp: Number,
		},

		// Duración del vuelo
		duration: {
			total: String, // Ej: "2h 30m"
			minutes: Number,
		},

		// Información de la aerolínea
		airline: {
			name: String,
			code: String,
			logo: String,
		},

		// Escalas
		stops: [
			{
				airport: String,
				city: String,
				duration: String,
			},
		],

		// Datos adicionales
		aircraft: String,
		bookingUrl: String,

		// Metadatos
		searchQuery: {
			origin: String,
			destination: String,
			departureDate: String,
			returnDate: String,
			passengers: Number,
		},

		// Timestamp de cuando se obtuvo la información
		scrapedAt: {
			type: Date,
			default: Date.now,
		},

		// Raw data por si necesitamos algo específico después
		rawData: mongoose.Schema.Types.Mixed,
	},
	{
		timestamps: true,
	}
);

// Índices para búsquedas eficientes
flightSchema.index({
	'origin.code': 1,
	'destination.code': 1,
	'departure.date': 1,
});
flightSchema.index({'price.amount': 1});
flightSchema.index({scrapedAt: 1});

module.exports = mongoose.model('Flight', flightSchema);
