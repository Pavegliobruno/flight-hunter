const express = require('express');
const mongoose = require('mongoose');
const MonitoringService = require('./src/services/monitoring.service');
const RouteMonitor = require('./src/models/routeMonitor.models');

if (process.env.NODE_ENV !== 'production') {
	require('dotenv').config();
}

console.log('🔧 Environment Debug:');
console.log('  NODE_ENV:', process.env.NODE_ENV);
console.log('  PORT:', process.env.PORT);
console.log(
	'  MONGODB_URI:',
	process.env.MONGODB_URI ? 'CONFIGURADO' : 'NO CONFIGURADO'
);
console.log(
	'  TELEGRAM_BOT_TOKEN:',
	process.env.TELEGRAM_BOT_TOKEN ? 'CONFIGURADO' : 'NO CONFIGURADO'
);
console.log(
	'  KIWI_UMBRELLA_TOKEN:',
	process.env.KIWI_UMBRELLA_TOKEN ? 'CONFIGURADO' : 'NO CONFIGURADO'
);

const app = express();
const PORT = process.env.PORT || 3000;

// Instancias de servicios
const monitoringService = new MonitoringService();

// Middleware
app.use(express.json());

// Conexión a MongoDB
mongoose
	.connect(process.env.MONGODB_URI)
	.then(() => console.log('✅ Conectado a MongoDB'))
	.catch((err) => console.error('❌ Error conectando a MongoDB:', err));

// ========================
// ENDPOINTS DE MONITOREO
// ========================

//  Crear monitor con nuevo formato
app.post('/monitors', async (req, res) => {
	try {
		const {
			name,
			origin,
			destination,
			priceThreshold,
			flightType = 'roundtrip',
			outboundDateRange,
			inboundDateRange,
			passengers = 1,
			checkInterval = 30,
			tags = [],
			notes = '',
			// Compatibilidad con formato anterior
			dateRange,
			returnDate,
		} = req.body;

		// Validaciones básicas
		if (!name || !origin || !destination || !priceThreshold) {
			return res.status(400).json({
				error:
					'Faltan parámetros requeridos: name, origin, destination, priceThreshold',
			});
		}

		// 🔥 NUEVO: Manejo de formato nuevo vs anterior
		let finalOutboundDateRange, finalInboundDateRange;

		if (outboundDateRange) {
			// Formato nuevo
			finalOutboundDateRange = outboundDateRange;
			finalInboundDateRange = inboundDateRange;
		} else if (dateRange) {
			// Formato anterior - convertir a nuevo formato
			finalOutboundDateRange = {
				startDate: dateRange.startDate,
				endDate: dateRange.endDate || dateRange.startDate,
				flexible: dateRange.flexible || false,
			};

			if (returnDate && flightType === 'roundtrip') {
				finalInboundDateRange = {
					startDate: returnDate,
					endDate: returnDate,
					flexible: false,
				};
			}
		} else {
			return res.status(400).json({
				error: 'Se requiere outboundDateRange o dateRange (formato anterior)',
			});
		}

		// Validar fechas de vuelta para roundtrip
		if (flightType === 'roundtrip' && !finalInboundDateRange) {
			return res.status(400).json({
				error: 'Se requiere inboundDateRange para vuelos de ida y vuelta',
			});
		}

		const routeMonitor = new RouteMonitor({
			name,
			origin: origin.toUpperCase(),
			destination: destination.toUpperCase(),
			priceThreshold,
			flightType,
			outboundDateRange: finalOutboundDateRange,
			inboundDateRange: finalInboundDateRange,
			passengers,
			checkInterval,
			tags,
			notes,
		});

		await routeMonitor.save();

		console.log(`📝 Nueva ruta de monitoreo creada: ${name} (${flightType})`);

		res.status(201).json({
			success: true,
			monitor: routeMonitor,
		});
	} catch (error) {
		console.error('❌ Error creando monitor:', error);
		res.status(500).json({error: error.message});
	}
});

// Forzar verificación manual de un monitor
app.post('/monitors/:id/check', async (req, res) => {
	try {
		const monitor = await RouteMonitor.findById(req.params.id);

		if (!monitor) {
			return res.status(404).json({error: 'Monitor no encontrado'});
		}

		console.log(`🔍 Verificación manual iniciada para: ${monitor.name}`);

		// 🔥 NUEVO: Mostrar qué fechas se van a buscar
		const searchDates = monitor.getSearchDates();

		// Ejecutar verificación en background
		monitoringService
			.checkRoute(monitor)
			.then(() => console.log(`✅ Verificación completada: ${monitor.name}`))
			.catch((err) => console.error(`❌ Error en verificación manual:`, err));

		res.json({
			success: true,
			message: 'Verificación iniciada',
			monitor: monitor.name,
			searchDates: searchDates,
		});
	} catch (error) {
		res.status(500).json({error: error.message});
	}
});

// ========================
// INICIALIZACIÓN
// ========================

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
	console.log(`🚀 Servidor corriendo en puerto ${PORT}`);

	// Verificar configuración
	if (!process.env.KIWI_UMBRELLA_TOKEN || !process.env.KIWI_VISITOR_UNIQID) {
		console.warn(
			'⚠️  ADVERTENCIA: Faltan tokens de Kiwi en las variables de entorno'
		);
		console.warn('   Seguí los pasos del DevTools para obtenerlos');
	}

	if (!process.env.TELEGRAM_BOT_TOKEN) {
		console.warn('⚠️  ADVERTENCIA: TELEGRAM_BOT_TOKEN no configurado');
		console.warn('   Las alertas por Telegram no funcionarán');
	}

	if (!process.env.TELEGRAM_CHAT_ID) {
		console.warn('⚠️  ADVERTENCIA: TELEGRAM_CHAT_ID no configurado');
		console.warn('   No se podrán enviar alertas');
	}

	// Iniciar monitoreo automático
	if (process.env.ENABLE_MONITORING === 'true') {
		setTimeout(() => {
			monitoringService.start();
		}, 5000);
	}
});

// Manejo de errores no capturados
process.on('unhandledRejection', (err) => {
	console.error('❌ Unhandled Promise Rejection:', err);
	process.exit(1);
});

module.exports = app;
