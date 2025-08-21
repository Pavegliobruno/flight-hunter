// src/services/telegramCommands.service.js
const RouteMonitor = require('../models/routeMonitor.models');

class TelegramCommandsService {
	constructor(telegramService) {
		this.telegramService = telegramService;
		this.commands = {
			'/start': this.handleStart.bind(this),
			'/help': this.handleHelp.bind(this),
			'/monitors': this.handleListMonitors.bind(this),
			'/status': this.handleStatus.bind(this),
			'/pause': this.handlePauseMonitor.bind(this),
			'/resume': this.handleResumeMonitor.bind(this),
		};
	}

	async handleCommand(msg, match) {
		const chatId = msg.chat.id;
		const commandWithoutSlash = match[1];
		const command = `/${commandWithoutSlash}`;
		const args = msg.text.split(' ').slice(1);

		try {
			if (this.commands[command]) {
				await this.commands[command](chatId, args, msg);
			} else {
				await this.sendMessage(
					chatId,
					'❌ Comando no reconocido. Usa /help para ver comandos disponibles.'
				);
			}
		} catch (error) {
			console.error(`❌ Error procesando comando ${command}:`, error);
			await this.sendMessage(
				chatId,
				'❌ Error procesando el comando. Intenta nuevamente.'
			);
		}
	}

	async handleStart(chatId) {
		const message = `🛫 <b>¡Bienvenido al Monitor de Vuelos de Kiwi!</b>

Recibirás alertas automáticas cuando encuentre precios bajos en las rutas que configuraste.

<b>Comandos disponibles:</b>
/help - Mostrar esta ayuda
/monitors - Ver todas las rutas monitoreadas
/status - Estado del sistema de monitoreo
/pause [ID] - Pausar un monitor específico
/resume [ID] - Reactivar un monitor pausado

<i>El sistema está monitoreando automáticamente cada 30 minutos.</i>`;

		await this.sendMessage(chatId, message);
	}

	async handleHelp(chatId) {
		const message = `📋 <b>Comandos del Monitor de Vuelos</b>

<b>/monitors</b> - Ver todas las rutas monitoreadas
   Muestra ID, ruta, estado y mejor precio

<b>/status</b> - Estado del sistema
   Estadísticas de monitoreo y última verificación

<b>/pause [ID]</b> - Pausar monitor
   Ejemplo: /pause 507f1f77bcf86cd799439011
   
<b>/resume [ID]</b> - Reactivar monitor
   Ejemplo: /resume 507f1f77bcf86cd799439011

<b>💡 Tip:</b> Usa /monitors para obtener los IDs de tus rutas`;

		await this.sendMessage(chatId, message);
	}

	async handleListMonitors(chatId) {
		try {
			const monitors = await RouteMonitor.find({}).sort({createdAt: -1});

			if (monitors.length === 0) {
				await this.sendMessage(chatId, '📭 No hay monitores configurados aún.');
				return;
			}

			let message = `📋 <b>Monitores de Vuelos (${monitors.length})</b>\n\n`;

			for (const monitor of monitors) {
				const status = monitor.isActive ? '✅ Activo' : '⏸️ Pausado';
				const bestPrice = monitor.bestPrice?.amount
					? `€${Math.round(monitor.bestPrice.amount)}`
					: 'N/A';

				const lastChecked = monitor.lastChecked
					? this.formatDate(monitor.lastChecked)
					: 'Nunca';

				const flightTypeIcon = monitor.flightType === 'roundtrip' ? '🔄' : '➡️';

				message += `${flightTypeIcon} <b>${monitor.name}</b>\n`;
				message += `📍 ${monitor.origin} → ${monitor.destination}\n`;
				message += `💰 Umbral: €${monitor.priceThreshold} | Mejor: ${bestPrice}\n`;
				message += `${status} | Última: ${lastChecked}\n`;
				message += `🆔 <code>${monitor._id}</code>\n\n`;

				// Telegram tiene límite de 4096 caracteres por mensaje
				if (message.length > 3500) {
					await this.sendMessage(chatId, message);
					message = '';
				}
			}

			if (message.length > 0) {
				await this.sendMessage(chatId, message);
			}

			// Mensaje con resumen
			const activeCount = monitors.filter((m) => m.isActive).length;
			const pausedCount = monitors.length - activeCount;

			const summary =
				`📊 <b>Resumen:</b> ${activeCount} activos, ${pausedCount} pausados\n\n` +
				`💡 <b>Tip:</b> Copia un ID y usa /pause [ID] o /resume [ID]`;

			await this.sendMessage(chatId, summary);
		} catch (error) {
			console.error('❌ Error obteniendo monitores:', error);
			await this.sendMessage(
				chatId,
				'❌ Error obteniendo la lista de monitores.'
			);
		}
	}

	async handleStatus(chatId) {
		try {
			const totalMonitors = await RouteMonitor.countDocuments();
			const activeMonitors = await RouteMonitor.countDocuments({
				isActive: true,
			});
			const pausedMonitors = totalMonitors - activeMonitors;

			// Monitores verificados hoy
			const todayStart = new Date();
			todayStart.setHours(0, 0, 0, 0);
			const checkedToday = await RouteMonitor.countDocuments({
				lastChecked: {$gte: todayStart},
			});

			// Último monitor verificado
			const lastChecked = await RouteMonitor.findOne({lastChecked: {$ne: null}})
				.sort({lastChecked: -1})
				.select('name lastChecked');

			const message = `📊 <b>Estado del Sistema de Monitoreo</b>

🔍 <b>Monitores:</b>
   • Total: ${totalMonitors}
   • Activos: ${activeMonitors}
   • Pausados: ${pausedMonitors}

📈 <b>Actividad de hoy:</b>
   • Verificados: ${checkedToday}/${activeMonitors}

⏰ <b>Última verificación:</b>
   ${
			lastChecked
				? `${lastChecked.name}\n   ${this.formatDate(lastChecked.lastChecked)}`
				: 'Ninguna aún'
		}

🤖 <b>Sistema:</b> ${process.env.ENABLE_MONITORING === 'true' ? '✅ Activo' : '⏸️ Pausado'}
⏱️ <b>Frecuencia:</b> Cada ${process.env.MONITORING_INTERVAL || 30} minutos`;

			await this.sendMessage(chatId, message);
		} catch (error) {
			console.error('❌ Error obteniendo estado:', error);
			await this.sendMessage(
				chatId,
				'❌ Error obteniendo el estado del sistema.'
			);
		}
	}

	async handlePauseMonitor(chatId, args) {
		if (args.length === 0) {
			await this.sendMessage(
				chatId,
				'❌ Falta el ID del monitor.\n\nUso: /pause [ID]\nEjemplo: /pause 507f1f77bcf86cd799439011\n\nUsa /monitors para ver los IDs disponibles.'
			);
			return;
		}

		const monitorId = args[0];

		try {
			const monitor = await RouteMonitor.findById(monitorId);

			if (!monitor) {
				await this.sendMessage(
					chatId,
					'❌ Monitor no encontrado. Verifica el ID con /monitors'
				);
				return;
			}

			if (!monitor.isActive) {
				await this.sendMessage(
					chatId,
					`⏸️ El monitor "${monitor.name}" ya está pausado.`
				);
				return;
			}

			monitor.isActive = false;
			await monitor.save();

			const message = `⏸️ <b>Monitor Pausado</b>

📍 <b>Ruta:</b> ${monitor.name}
🛫 ${monitor.origin} → ${monitor.destination}
💰 Umbral: €${monitor.priceThreshold}

El monitor dejará de verificar precios hasta que lo reactives con:
<code>/resume ${monitorId}</code>`;

			await this.sendMessage(chatId, message);

			console.log(
				`⏸️ Monitor pausado por Telegram: ${monitor.name} (${monitorId})`
			);
		} catch (error) {
			console.error('❌ Error pausando monitor:', error);

			if (error.name === 'CastError') {
				await this.sendMessage(
					chatId,
					'❌ ID de monitor inválido. Verifica el formato con /monitors'
				);
			} else {
				await this.sendMessage(
					chatId,
					'❌ Error pausando el monitor. Intenta nuevamente.'
				);
			}
		}
	}

	async handleResumeMonitor(chatId, args) {
		if (args.length === 0) {
			await this.sendMessage(
				chatId,
				'❌ Falta el ID del monitor.\n\nUso: /resume [ID]\nEjemplo: /resume 507f1f77bcf86cd799439011\n\nUsa /monitors para ver los IDs disponibles.'
			);
			return;
		}

		const monitorId = args[0];

		try {
			const monitor = await RouteMonitor.findById(monitorId);

			if (!monitor) {
				await this.sendMessage(
					chatId,
					'❌ Monitor no encontrado. Verifica el ID con /monitors'
				);
				return;
			}

			if (monitor.isActive) {
				await this.sendMessage(
					chatId,
					`✅ El monitor "${monitor.name}" ya está activo.`
				);
				return;
			}

			monitor.isActive = true;
			await monitor.save();

			const message = `✅ <b>Monitor Reactivado</b>

📍 <b>Ruta:</b> ${monitor.name}
🛫 ${monitor.origin} → ${monitor.destination}
💰 Umbral: €${monitor.priceThreshold}

El monitor volverá a verificar precios en el próximo ciclo de monitoreo.

Para pausarlo nuevamente usa:
<code>/pause ${monitorId}</code>`;

			await this.sendMessage(chatId, message);

			console.log(
				`✅ Monitor reactivado por Telegram: ${monitor.name} (${monitorId})`
			);
		} catch (error) {
			console.error('❌ Error reactivando monitor:', error);

			if (error.name === 'CastError') {
				await this.sendMessage(
					chatId,
					'❌ ID de monitor inválido. Verifica el formato con /monitors'
				);
			} else {
				await this.sendMessage(
					chatId,
					'❌ Error reactivando el monitor. Intenta nuevamente.'
				);
			}
		}
	}

	// Métodos auxiliares
	async sendMessage(chatId, text) {
		if (this.telegramService.bot) {
			await this.telegramService.bot.sendMessage(chatId, text, {
				parse_mode: 'HTML',
				disable_web_page_preview: true,
			});
		}
	}

	formatDate(date) {
		if (!date) return 'N/A';

		const now = new Date();
		const diffMs = now - new Date(date);
		const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
		const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

		if (diffHours < 1) {
			return `Hace ${diffMinutes}m`;
		} else if (diffHours < 24) {
			return `Hace ${diffHours}h ${diffMinutes}m`;
		} else {
			return new Date(date).toLocaleDateString('es-ES', {
				day: '2-digit',
				month: '2-digit',
				year: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
			});
		}
	}
}

module.exports = TelegramCommandsService;
