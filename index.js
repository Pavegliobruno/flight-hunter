const express = require('express');
const mongoose = require('mongoose');
const MonitoringService = require('./src/services/monitoring.service');
const RouteMonitor = require('./src/models/routeMonitor.models');
const User = require('./src/models/user.model'); // NUEVO

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
// ENDPOINTS DE USUARIOS
// ========================

// NUEVO: Obtener o crear usuario por Telegram ID
app.get('/users/telegram/:telegramId', async (req, res) => {
	try {
		const {telegramId} = req.params;

		const user = await User.findOne({telegramId});

		if (!user) {
			return res.status(404).json({
				error: 'Usuario no encontrado',
				telegramId,
			});
		}

		res.json({
			success: true,
			user,
		});
	} catch (error) {
		console.error('❌ Error obteniendo usuario:', error);
		res.status(500).json({error: error.message});
	}
});

// NUEVO: Actualizar configuración de usuario
app.patch('/users/:userId/preferences', async (req, res) => {
	try {
		const {userId} = req.params;
		const {preferences} = req.body;

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({error: 'Usuario no encontrado'});
		}

		// Actualizar preferencias
		if (preferences) {
			user.preferences = {...user.preferences, ...preferences};
		}

		await user.save();

		res.json({
			success: true,
			user,
			message: 'Preferencias actualizadas',
		});
	} catch (error) {
		console.error('❌ Error actualizando preferencias:', error);
		res.status(500).json({error: error.message});
	}
});

// NUEVO: Obtener estadísticas de usuario
app.get('/users/:userId/stats', async (req, res) => {
	try {
		const {userId} = req.params;

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({error: 'Usuario no encontrado'});
		}

		// Obtener monitores del usuario
		const monitors = await RouteMonitor.find({userId}).select('isActive stats');

		// Calcular estadísticas adicionales
		const totalAlertsSent = monitors.reduce(
			(sum, m) => sum + (m.stats.alertsSent || 0),
			0
		);
		const totalChecks = monitors.reduce(
			(sum, m) => sum + (m.stats.totalChecks || 0),
			0
		);

		res.json({
			success: true,
			user: {
				id: user._id,
				name: user.firstName,
				stats: {
					...user.stats,
					totalAlertsSent,
					totalChecks,
				},
				preferences: user.preferences,
				registeredAt: user.registeredAt,
				lastActivity: user.lastActivity,
			},
			monitors: {
				total: monitors.length,
				active: monitors.filter((m) => m.isActive).length,
				inactive: monitors.filter((m) => !m.isActive).length,
			},
		});
	} catch (error) {
		console.error('❌ Error obteniendo estadísticas:', error);
		res.status(500).json({error: error.message});
	}
});

// ========================
// ENDPOINTS DE MONITOREO (ACTUALIZADOS)
// ========================

// ACTUALIZADO: Crear monitor con usuario
app.post('/monitors', async (req, res) => {
	try {
		const {
			telegramId, // NUEVO: Requerido para asociar al usuario
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

		// NUEVO: Validar que se proporcione telegramId
		if (!telegramId) {
			return res.status(400).json({
				error: 'Se requiere telegramId para asociar el monitor a un usuario',
			});
		}

		// Buscar o crear usuario
		const user = await User.findOne({telegramId});
		if (!user) {
			return res.status(404).json({
				error: 'Usuario no encontrado. El usuario debe iniciar el bot primero.',
				telegramId,
			});
		}

		// Verificar límites del usuario
		if (!user.canCreateMonitor()) {
			return res.status(400).json({
				error: `Has alcanzado el límite de monitores (${user.limits.maxMonitors}). Pausa o elimina algunos monitores existentes.`,
				currentMonitors: user.stats.activeMonitors,
				maxMonitors: user.limits.maxMonitors,
			});
		}

		// Validaciones básicas
		if (!name || !origin || !destination || !priceThreshold) {
			return res.status(400).json({
				error:
					'Faltan parámetros requeridos: name, origin, destination, priceThreshold',
			});
		}

		// Manejo de formato nuevo vs anterior
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
			userId: user._id, // NUEVO: Asociar al usuario
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

		console.log(
			`📝 Nueva ruta de monitoreo creada para ${user.firstName}: ${name} (${flightType})`
		);

		res.status(201).json({
			success: true,
			monitor: routeMonitor,
			user: {
				id: user._id,
				name: user.firstName,
				availableSlots: user.limits.maxMonitors - user.stats.activeMonitors - 1,
			},
		});
	} catch (error) {
		console.error('❌ Error creando monitor:', error);
		res.status(500).json({error: error.message});
	}
});

// ACTUALIZADO: Obtener monitores de un usuario específico
app.get('/monitors/user/:telegramId', async (req, res) => {
	try {
		const {telegramId} = req.params;

		// Buscar usuario
		const user = await User.findOne({telegramId});
		if (!user) {
			return res.status(404).json({
				error: 'Usuario no encontrado',
				telegramId,
			});
		}

		// Obtener monitores del usuario
		const monitors = await RouteMonitor.find({userId: user._id}).sort({
			createdAt: -1,
		});

		res.json({
			success: true,
			user: {
				id: user._id,
				name: user.firstName,
				stats: user.stats,
				limits: user.limits,
			},
			monitors,
			count: monitors.length,
		});
	} catch (error) {
		console.error('❌ Error obteniendo monitores del usuario:', error);
		res.status(500).json({error: error.message});
	}
});

// ACTUALIZADO: Verificación manual (ahora verifica permisos de usuario)
app.post('/monitors/:id/check', async (req, res) => {
	try {
		const {telegramId} = req.body; // NUEVO: Verificar permisos

		const monitor = await RouteMonitor.findById(req.params.id).populate(
			'userId'
		);

		if (!monitor) {
			return res.status(404).json({error: 'Monitor no encontrado'});
		}

		// NUEVO: Verificar que el usuario sea el propietario
		if (telegramId && monitor.userId.telegramId !== telegramId) {
			return res.status(403).json({
				error: 'No tienes permisos para verificar este monitor',
			});
		}

		console.log(
			`🔍 Verificación manual iniciada para: ${monitor.name} (${monitor.userId.firstName})`
		);

		const searchDates = monitor.getSearchDates();

		// Ejecutar verificación en background
		monitoringService
			.checkRoute(monitor, monitor.userId)
			.then(() => console.log(`✅ Verificación completada: ${monitor.name}`))
			.catch((err) => console.error(`❌ Error en verificación manual:`, err));

		res.json({
			success: true,
			message: 'Verificación iniciada',
			monitor: monitor.name,
			user: monitor.userId.firstName,
			searchDates: searchDates,
		});
	} catch (error) {
		console.error('❌ Error en verificación manual:', error);
		res.status(500).json({error: error.message});
	}
});

// NUEVO: Pausar/reactivar monitor con verificación de permisos
app.patch('/monitors/:id/toggle', async (req, res) => {
	try {
		const {telegramId} = req.body;

		const monitor = await RouteMonitor.findById(req.params.id).populate(
			'userId'
		);

		if (!monitor) {
			return res.status(404).json({error: 'Monitor no encontrado'});
		}

		// Verificar permisos
		if (telegramId && monitor.userId.telegramId !== telegramId) {
			return res.status(403).json({
				error: 'No tienes permisos para modificar este monitor',
			});
		}

		// Cambiar estado
		monitor.isActive = !monitor.isActive;
		await monitor.save();

		const action = monitor.isActive ? 'reactivado' : 'pausado';
		console.log(
			`⚡ Monitor ${action} por ${monitor.userId.firstName}: ${monitor.name}`
		);

		res.json({
			success: true,
			monitor,
			message: `Monitor ${action} exitosamente`,
			action: monitor.isActive ? 'activated' : 'paused',
		});
	} catch (error) {
		console.error('❌ Error cambiando estado del monitor:', error);
		res.status(500).json({error: error.message});
	}
});

// NUEVO: Eliminar monitor con verificación de permisos
app.delete('/monitors/:id', async (req, res) => {
	try {
		const {telegramId} = req.body;

		const monitor = await RouteMonitor.findById(req.params.id).populate(
			'userId'
		);

		if (!monitor) {
			return res.status(404).json({error: 'Monitor no encontrado'});
		}

		// Verificar permisos
		if (telegramId && monitor.userId.telegramId !== telegramId) {
			return res.status(403).json({
				error: 'No tienes permisos para eliminar este monitor',
			});
		}

		await RouteMonitor.findByIdAndDelete(req.params.id);

		console.log(
			`🗑️ Monitor eliminado por ${monitor.userId.firstName}: ${monitor.name}`
		);

		res.json({
			success: true,
			message: 'Monitor eliminado exitosamente',
			deletedMonitor: {
				id: monitor._id,
				name: monitor.name,
			},
		});
	} catch (error) {
		console.error('❌ Error eliminando monitor:', error);
		res.status(500).json({error: error.message});
	}
});

// ========================
// ENDPOINTS DE SISTEMA
// ========================

// ACTUALIZADO: Estado del sistema con información de usuarios
app.get('/monitoring/status', async (req, res) => {
	try {
		const totalUsers = await User.countDocuments();
		const activeUsers = await User.countDocuments({isActive: true});
		const totalMonitors = await RouteMonitor.countDocuments();
		const activeMonitors = await RouteMonitor.countDocuments({isActive: true});

		// Top usuarios más activos
		const topUsers = await User.find({isActive: true})
			.sort({'stats.alertsReceived': -1})
			.limit(5)
			.select('firstName stats.alertsReceived stats.activeMonitors');

		// Monitores verificados hoy
		const todayStart = new Date();
		todayStart.setHours(0, 0, 0, 0);
		const checkedToday = await RouteMonitor.countDocuments({
			lastChecked: {$gte: todayStart},
		});

		const systemStats = {
			users: {
				total: totalUsers,
				active: activeUsers,
				inactive: totalUsers - activeUsers,
			},
			monitors: {
				total: totalMonitors,
				active: activeMonitors,
				inactive: totalMonitors - activeMonitors,
				checkedToday,
			},
			monitoring: monitoringService.getStats(),
			topUsers,
		};

		res.json({
			success: true,
			stats: systemStats,
			timestamp: new Date(),
		});
	} catch (error) {
		console.error('❌ Error obteniendo estado del sistema:', error);
		res.status(500).json({error: error.message});
	}
});

// NUEVO: Testear Telegram para un usuario específico
app.post('/telegram/test/:telegramId', async (req, res) => {
	try {
		const {telegramId} = req.params;

		const user = await User.findOne({telegramId});
		if (!user) {
			return res.status(404).json({
				error: 'Usuario no encontrado',
			});
		}

		// Enviar mensaje de test
		const result = await monitoringService.telegramService.sendTestMessage();

		res.json({
			success: result.success,
			message: result.message || result.error,
			user: {
				id: user._id,
				name: user.firstName,
			},
		});
	} catch (error) {
		console.error('❌ Error enviando test de Telegram:', error);
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

	// Iniciar monitoreo automático
	if (process.env.ENABLE_MONITORING === 'true') {
		setTimeout(() => {
			monitoringService.start();
		}, 5000);
	}

	console.log('\n📋 ENDPOINTS DISPONIBLES:');
	console.log('👥 Usuarios:');
	console.log('  GET  /users/telegram/:telegramId - Obtener usuario');
	console.log('  PATCH /users/:userId/preferences - Actualizar preferencias');
	console.log('  GET  /users/:userId/stats - Estadísticas de usuario');
	console.log('\n📊 Monitores:');
	console.log('  POST /monitors - Crear monitor (requiere telegramId)');
	console.log('  GET  /monitors/user/:telegramId - Monitores de usuario');
	console.log('  POST /monitors/:id/check - Verificación manual');
	console.log('  PATCH /monitors/:id/toggle - Pausar/reactivar');
	console.log('  DELETE /monitors/:id - Eliminar monitor');
	console.log('\n🔧 Sistema:');
	console.log('  GET  /monitoring/status - Estado del sistema');
	console.log('  POST /telegram/test/:telegramId - Test Telegram');
});

// Manejo de errores no capturados
process.on('unhandledRejection', (err) => {
	console.error('❌ Unhandled Promise Rejection:', err);
	process.exit(1);
});

module.exports = app;
