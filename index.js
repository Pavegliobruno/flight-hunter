const express = require('express');
const mongoose = require('mongoose');
const KiwiService = require('./src/services/kiwi.service');
const MonitoringService = require('./src/services/monitoring.service');
const TelegramService = require('./src/services/telegram.service');
const Flight = require('./src/models/flight.model');
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
const kiwiService = new KiwiService();
const monitoringService = new MonitoringService();
const telegramService = new TelegramService();

// Middleware
app.use(express.json());

// Conexión a MongoDB
mongoose
	.connect(process.env.MONGODB_URI)
	.then(() => console.log('✅ Conectado a MongoDB'))
	.catch((err) => console.error('❌ Error conectando a MongoDB:', err));

// ========================
// RUTAS PRINCIPALES
// ========================

app.get('/', (req, res) => {
	res.json({
		message: 'Kiwi Flight Scraper API v2.0',
		endpoints: {
			search: 'POST /search',
			flights: 'GET /flights',
			flightsByRoute: 'GET /flights/:origin/:destination',
			monitors: 'GET /monitors',
			createMonitor: 'POST /monitors',
			updateMonitor: 'PUT /monitors/:id',
			deleteMonitor: 'DELETE /monitors/:id',
			monitoringStatus: 'GET /monitoring/status',
			testTelegram: 'POST /telegram/test',
		},
		features: {
			roundtripSupport: true,
			dateRanges: true,
			automaticMonitoring: true,
			telegramAlerts: true,
		},
	});
});

// ========================
// ENDPOINTS DE BÚSQUEDA
// ========================

app.post('/search', async (req, res) => {
	try {
		const {origin, destination, departureDate, returnDate, passengers} =
			req.body;

		if (!origin || !destination || !departureDate) {
			return res.status(400).json({
				error:
					'Faltan parámetros requeridos: origin, destination, departureDate',
			});
		}

		console.log(`🚀 Iniciando búsqueda de vuelos...`);

		const rawData = await kiwiService.searchFlights({
			origin,
			destination,
			departureDate,
			returnDate,
			passengers,
		});

		const flights = kiwiService.parseFlightData(rawData, {
			origin,
			destination,
			departureDate,
			returnDate,
			passengers,
		});

		console.log(`📊 Encontrados ${flights.length} vuelos`);

		// Guardar en MongoDB
		const savedFlights = [];
		for (const flightData of flights) {
			try {
				const flight = new Flight(flightData);
				await flight.save();
				savedFlights.push(flight);
			} catch (saveError) {
				if (saveError.code !== 11000) {
					console.error('Error guardando vuelo:', saveError);
				}
			}
		}

		console.log(`💾 Guardados ${savedFlights.length} vuelos nuevos en MongoDB`);

		res.json({
			success: true,
			total: flights.length,
			saved: savedFlights.length,
			flights: flights.slice(0, 10),
		});
	} catch (error) {
		console.error('❌ Error en /search:', error);
		res.status(500).json({
			error: error.message,
			details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
		});
	}
});

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

// Obtener todos los monitores
app.get('/monitors', async (req, res) => {
	try {
		const {active, tag, flightType} = req.query;

		const filter = {};
		if (active !== undefined) filter.isActive = active === 'true';
		if (tag) filter.tags = tag;
		if (flightType) filter.flightType = flightType;

		const monitors = await RouteMonitor.find(filter).sort({createdAt: -1});

		res.json({
			monitors,
			count: monitors.length,
			breakdown: {
				roundtrip: monitors.filter((m) => m.flightType === 'roundtrip').length,
				oneway: monitors.filter((m) => m.flightType === 'oneway').length,
				active: monitors.filter((m) => m.isActive).length,
			},
		});
	} catch (error) {
		res.status(500).json({error: error.message});
	}
});

// Obtener monitor específico
app.get('/monitors/:id', async (req, res) => {
	try {
		const monitor = await RouteMonitor.findById(req.params.id);

		if (!monitor) {
			return res.status(404).json({error: 'Monitor no encontrado'});
		}

		// 🔥 NUEVO: Mostrar próximas fechas de búsqueda
		const searchDates = monitor.getSearchDates();

		res.json({
			...monitor.toObject(),
			nextSearchDates: searchDates,
		});
	} catch (error) {
		res.status(500).json({error: error.message});
	}
});

// 🔥 RUTA ACTUALIZADA: Actualizar monitor
app.put('/monitors/:id', async (req, res) => {
	try {
		const updateData = req.body;

		// Si se está actualizando con formato anterior, convertir
		if (updateData.dateRange && !updateData.outboundDateRange) {
			updateData.outboundDateRange = {
				startDate: updateData.dateRange.startDate,
				endDate: updateData.dateRange.endDate || updateData.dateRange.startDate,
				flexible: updateData.dateRange.flexible || false,
			};

			if (updateData.returnDate) {
				updateData.inboundDateRange = {
					startDate: updateData.returnDate,
					endDate: updateData.returnDate,
					flexible: false,
				};
			}

			// Limpiar campos antiguos
			delete updateData.dateRange;
			delete updateData.returnDate;
		}

		const monitor = await RouteMonitor.findByIdAndUpdate(
			req.params.id,
			updateData,
			{new: true, runValidators: true}
		);

		if (!monitor) {
			return res.status(404).json({error: 'Monitor no encontrado'});
		}

		console.log(`📝 Monitor actualizado: ${monitor.name}`);
		res.json(monitor);
	} catch (error) {
		res.status(500).json({error: error.message});
	}
});

// Activar/desactivar monitor
app.patch('/monitors/:id/toggle', async (req, res) => {
	try {
		const monitor = await RouteMonitor.findById(req.params.id);

		if (!monitor) {
			return res.status(404).json({error: 'Monitor no encontrado'});
		}

		monitor.isActive = !monitor.isActive;
		await monitor.save();

		console.log(
			`${monitor.isActive ? '✅' : '⏸️'} Monitor ${monitor.isActive ? 'activado' : 'desactivado'}: ${monitor.name}`
		);

		res.json({
			success: true,
			monitor,
			message: `Monitor ${monitor.isActive ? 'activado' : 'desactivado'}`,
		});
	} catch (error) {
		res.status(500).json({error: error.message});
	}
});

// Eliminar monitor
app.delete('/monitors/:id', async (req, res) => {
	try {
		const monitor = await RouteMonitor.findByIdAndDelete(req.params.id);

		if (!monitor) {
			return res.status(404).json({error: 'Monitor no encontrado'});
		}

		console.log(`🗑️ Monitor eliminado: ${monitor.name}`);
		res.json({success: true, message: 'Monitor eliminado'});
	} catch (error) {
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

// 🔥 NUEVA RUTA: Preview de fechas de búsqueda
app.post('/monitors/preview-dates', (req, res) => {
	try {
		const {outboundDateRange, inboundDateRange, flightType} = req.body;

		if (!outboundDateRange) {
			return res.status(400).json({
				error: 'Se requiere outboundDateRange',
			});
		}

		// Crear un monitor temporal para obtener las fechas
		const tempMonitor = new RouteMonitor({
			name: 'temp',
			origin: 'XXX',
			destination: 'YYY',
			priceThreshold: 100,
			flightType: flightType || 'roundtrip',
			outboundDateRange,
			inboundDateRange,
		});

		const searchDates = tempMonitor.getSearchDates();

		res.json({
			outboundDates: searchDates.outbound,
			inboundDates: searchDates.inbound,
			totalCombinations:
				searchDates.outbound.length * (searchDates.inbound.length || 1),
			estimatedSearchTime: `${searchDates.outbound.length * (searchDates.inbound.length || 1) * 5} segundos aprox.`,
		});
	} catch (error) {
		res.status(500).json({error: error.message});
	}
});

// ========================
// ENDPOINTS DE VUELOS
// ========================

app.get('/flights', async (req, res) => {
	try {
		const {
			limit = 50,
			page = 1,
			origin,
			destination,
			sortBy = 'price.amount',
		} = req.query;

		const filter = {};
		if (origin) filter['origin.code'] = origin.toUpperCase();
		if (destination) filter['destination.code'] = destination.toUpperCase();

		const flights = await Flight.find(filter)
			.sort({[sortBy]: 1})
			.limit(limit * 1)
			.skip((page - 1) * limit)
			.select('-rawData');

		const total = await Flight.countDocuments(filter);

		res.json({
			flights,
			pagination: {
				total,
				page: parseInt(page),
				limit: parseInt(limit),
				pages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		res.status(500).json({error: error.message});
	}
});

app.get('/flights/:origin/:destination', async (req, res) => {
	try {
		const {origin, destination} = req.params;
		const {days = 7, sortBy = 'price.amount'} = req.query;

		const dateFrom = new Date();
		const dateTo = new Date();
		dateTo.setDate(dateTo.getDate() + parseInt(days));

		const flights = await Flight.find({
			'origin.code': origin.toUpperCase(),
			'destination.code': destination.toUpperCase(),
			'departure.date': {
				$gte: dateFrom,
				$lte: dateTo,
			},
		})
			.sort({[sortBy]: 1})
			.select('-rawData')
			.limit(100);

		res.json({
			route: `${origin.toUpperCase()} → ${destination.toUpperCase()}`,
			flights,
			count: flights.length,
		});
	} catch (error) {
		res.status(500).json({error: error.message});
	}
});

// ========================
// ENDPOINTS DE ESTADÍSTICAS
// ========================

app.get('/stats', async (req, res) => {
	try {
		const totalFlights = await Flight.countDocuments();
		const uniqueRoutes = await Flight.distinct('searchQuery.origin');
		const lastUpdate = await Flight.findOne()
			.sort({scrapedAt: -1})
			.select('scrapedAt');

		const priceStats = await Flight.aggregate([
			{
				$group: {
					_id: null,
					avgPrice: {$avg: '$price.amount'},
					minPrice: {$min: '$price.amount'},
					maxPrice: {$max: '$price.amount'},
				},
			},
		]);

		// Estadísticas de monitores
		const monitorStats = await RouteMonitor.aggregate([
			{
				$group: {
					_id: '$flightType',
					count: {$sum: 1},
					active: {
						$sum: {$cond: ['$isActive', 1, 0]},
					},
				},
			},
		]);

		res.json({
			flights: {
				total: totalFlights,
				uniqueRoutes: uniqueRoutes.length,
				lastUpdate: lastUpdate?.scrapedAt,
				priceStats: priceStats[0] || {},
			},
			monitors: {
				breakdown: monitorStats,
				total: await RouteMonitor.countDocuments(),
				active: await RouteMonitor.countDocuments({isActive: true}),
			},
		});
	} catch (error) {
		res.status(500).json({error: error.message});
	}
});

// ========================
// ENDPOINTS DE TELEGRAM
// ========================

app.post('/telegram/test', async (req, res) => {
	try {
		const result = await telegramService.sendTestMessage();
		res.json(result);
	} catch (error) {
		res.status(500).json({error: error.message});
	}
});

// ========================
// ENDPOINTS DE MONITOREO
// ========================

app.get('/monitoring/status', async (req, res) => {
	try {
		const monitoringStats = monitoringService.getStats();
		const activeMonitors = await RouteMonitor.countDocuments({isActive: true});
		const totalMonitors = await RouteMonitor.countDocuments();

		const todayStart = new Date();
		todayStart.setHours(0, 0, 0, 0);

		const flightsToday = await Flight.countDocuments({
			scrapedAt: {$gte: todayStart},
		});

		const monitorsCheckedToday = await RouteMonitor.countDocuments({
			lastChecked: {$gte: todayStart},
		});

		res.json({
			monitoring: monitoringStats,
			monitors: {
				active: activeMonitors,
				total: totalMonitors,
				checkedToday: monitorsCheckedToday,
			},
			flights: {
				foundToday: flightsToday,
			},
			lastUpdate: new Date(),
		});
	} catch (error) {
		res.status(500).json({error: error.message});
	}
});

app.post('/monitoring/:action', (req, res) => {
	try {
		const {action} = req.params;

		if (action === 'start') {
			monitoringService.start();
			res.json({success: true, message: 'Monitoreo iniciado'});
		} else if (action === 'stop') {
			monitoringService.stop();
			res.json({success: true, message: 'Monitoreo detenido'});
		} else {
			res.status(400).json({error: 'Acción inválida. Usa start o stop'});
		}
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
