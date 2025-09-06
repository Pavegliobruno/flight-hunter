const RouteMonitor = require('../models/routeMonitor.models');

class TelegramCommandsService {
	constructor(telegramService) {
		this.telegramService = telegramService;
		this.commands = {
			'/start': this.handleStart.bind(this),
			'/help': this.handleHelp.bind(this),
			'/monitors': this.handleListMonitors.bind(this),
			'/status': this.handleStatus.bind(this),
			'/settings': this.handleSettings.bind(this),
			'/pause': this.handlePauseMonitor.bind(this),
			'/resume': this.handleResumeMonitor.bind(this),
		};
	}

	// ACTUALIZADO: Ahora recibe el usuario como parámetro
	async handleCommand(msg, match, user) {
		const chatId = msg.chat.id;
		const commandWithoutSlash = match[1];
		const command = `/${commandWithoutSlash}`;
		const args = msg.text.split(' ').slice(1);

		try {
			if (this.commands[command]) {
				await this.commands[command](chatId, args, msg, user);
			} else {
				const lang = user.preferences.language;
				const text =
					lang === 'en'
						? '❌ Command not recognized. Use /help to see available commands.'
						: '❌ Comando no reconocido. Usa /help para ver comandos disponibles.';
				await this.sendMessage(chatId, text);
			}
		} catch (error) {
			console.error(`❌ Error procesando comando ${command}:`, error);
			const lang = user.preferences.language;
			const text =
				lang === 'en'
					? '❌ Error processing command. Please try again.'
					: '❌ Error procesando el comando. Intenta nuevamente.';
			await this.sendMessage(chatId, text);
		}
	}

	async handleStart(chatId, args, msg, user) {
		const lang = user.preferences.language;

		if (lang === 'en') {
			const message = `🛫 <b>Welcome to Kiwi Flight Monitor!</b>

Hello ${user.firstName}! You'll receive automatic alerts when I find low prices on the routes you configure.

<b>Available commands:</b>
/help - Show this help
/monitors - View all your monitored routes
/status - Your monitoring status and stats
/settings - Configure your preferences
/pause [ID] - Pause a specific monitor
/resume [ID] - Reactivate a paused monitor

<i>The system is automatically monitoring every 30 minutes.</i>

💡 <b>Tip:</b> You have ${user.limits.maxMonitors - user.stats.activeMonitors} monitor slots available!`;

			await this.sendMessage(chatId, message);
		} else {
			const message = `🛫 <b>¡Bienvenido al Monitor de Vuelos de Kiwi!</b>

¡Hola ${user.firstName}! Recibirás alertas automáticas cuando encuentre precios bajos en las rutas que configures.

<b>Comandos disponibles:</b>
/help - Mostrar esta ayuda
/monitors - Ver todas tus rutas monitoreadas
/status - Tu estado y estadísticas de monitoreo
/settings - Configurar tus preferencias
/pause [ID] - Pausar un monitor específico
/resume [ID] - Reactivar un monitor pausado

<i>El sistema está monitoreando automáticamente cada 30 minutos.</i>

💡 <b>Tip:</b> ¡Tienes ${user.limits.maxMonitors - user.stats.activeMonitors} espacios disponibles para monitores!`;

			await this.sendMessage(chatId, message);
		}
	}

	async handleHelp(chatId, args, msg, user) {
		const lang = user.preferences.language;
		let message;
		if (lang === 'en') {
			message = `📋 <b>Flight Monitor Commands</b>

<b>/monitors</b> - View all your monitored routes
   Shows ID, route, status and best price

<b>/status</b> - Your monitoring statistics
   Stats and last verification time

<b>/settings</b> - Configure preferences
   Language, timezone, notifications, quiet hours

<b>/pause [ID]</b> - Pause monitor
   Example: /pause 507f1f77bcf86cd799439011
   
<b>/resume [ID]</b> - Reactivate monitor
   Example: /resume 507f1f77bcf86cd799439011

💡 <b>Tip:</b> Use /monitors to get your route IDs

🔧 <b>To add new routes:</b> Use the web interface or API
📊 <b>Limits:</b> ${user.limits.maxMonitors} monitors, ${user.limits.maxAlertsPerDay} alerts/day`;
		} else {
			message = `📋 <b>Comandos del Monitor de Vuelos</b>

<b>/monitors</b> - Ver todas tus rutas monitoreadas
   Muestra ID, ruta, estado y mejor precio

<b>/status</b> - Tus estadísticas de monitoreo
   Estadísticas y última verificación

<b>/settings</b> - Configurar preferencias
   Idioma, zona horaria, notificaciones, horas silenciosas

<b>/pause [ID]</b> - Pausar monitor
   Ejemplo: /pause 507f1f77bcf86cd799439011
   
<b>/resume [ID]</b> - Reactivar monitor
   Ejemplo: /resume 507f1f77bcf86cd799439011

💡 <b>Tip:</b> Usa /monitors para obtener los IDs de tus rutas

🔧 <b>Para agregar nuevas rutas:</b> Usa la interfaz web o API
📊 <b>Límites:</b> ${user.limits.maxMonitors} monitores, ${user.limits.maxAlertsPerDay} alertas/día`;
		}

		await this.sendMessage(chatId, message);
	}

	async handleListMonitors(chatId, args, msg, user) {
		try {
			// NUEVO: Solo buscar monitores del usuario
			const monitors = await RouteMonitor.find({userId: user._id}).sort({
				createdAt: -1,
			});

			const lang = user.preferences.language;

			if (monitors.length === 0) {
				const text =
					lang === 'en'
						? '📭 No monitors configured yet.\n\n🔧 Use the web interface or API to add your first flight route!'
						: '📭 No hay monitores configurados aún.\n\n🔧 ¡Usa la interfaz web o API para agregar tu primera ruta de vuelo!';
				await this.sendMessage(chatId, text);
				return;
			}

			const title =
				lang === 'en'
					? `📋 <b>Your Flight Monitors (${monitors.length})</b>\n\n`
					: `📋 <b>Tus Monitores de Vuelos (${monitors.length})</b>\n\n`;

			let message = title;

			for (const monitor of monitors) {
				const statusText =
					lang === 'en'
						? monitor.isActive
							? '✅ Active'
							: '⏸️ Paused'
						: monitor.isActive
							? '✅ Activo'
							: '⏸️ Pausado';

				const bestPrice = monitor.bestPrice?.amount
					? `€${Math.round(monitor.bestPrice.amount)}`
					: lang === 'en'
						? 'N/A'
						: 'N/D';

				const lastChecked = monitor.lastChecked
					? this.formatDate(monitor.lastChecked, user)
					: lang === 'en'
						? 'Never'
						: 'Nunca';

				const flightTypeIcon = monitor.flightType === 'roundtrip' ? '🔄' : '➡️';
				const thresholdText = lang === 'en' ? 'Threshold' : 'Umbral';
				const bestText = lang === 'en' ? 'Best' : 'Mejor';
				const lastText = lang === 'en' ? 'Last' : 'Última';

				message += `${flightTypeIcon} <b>${monitor.name}</b>\n`;
				message += `📍 ${monitor.origin} → ${monitor.destination}\n`;
				message += `💰 ${thresholdText}: €${monitor.priceThreshold} | ${bestText}: ${bestPrice}\n`;
				message += `${statusText} | ${lastText}: ${lastChecked}\n`;
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

			const summaryTexts =
				lang === 'en'
					? {
							summary: 'Summary',
							active: 'active',
							paused: 'paused',
							tip: 'Tip',
							copy: 'Copy an ID and use',
							or: 'or',
							available: 'Available slots',
						}
					: {
							summary: 'Resumen',
							active: 'activos',
							paused: 'pausados',
							tip: 'Tip',
							copy: 'Copia un ID y usa',
							or: 'o',
							available: 'Espacios disponibles',
						};

			const summary =
				`📊 <b>${summaryTexts.summary}:</b> ${activeCount} ${summaryTexts.active}, ${pausedCount} ${summaryTexts.paused}\n` +
				`📈 <b>${summaryTexts.available}:</b> ${user.limits.maxMonitors - user.stats.activeMonitors}\n\n` +
				`💡 <b>${summaryTexts.tip}:</b> ${summaryTexts.copy} /pause [ID] ${summaryTexts.or} /resume [ID]`;

			await this.sendMessage(chatId, summary);
		} catch (error) {
			console.error('❌ Error obteniendo monitores:', error);
			const lang = user.preferences.language;
			const text =
				lang === 'en'
					? '❌ Error getting monitor list.'
					: '❌ Error obteniendo la lista de monitores.';
			await this.sendMessage(chatId, text);
		}
	}

	async handleStatus(chatId, args, msg, user) {
		try {
			await this.telegramService.sendUserStats(user);
		} catch (error) {
			console.error('❌ Error obteniendo estado:', error);
			const lang = user.preferences.language;
			const text =
				lang === 'en'
					? '❌ Error getting system status.'
					: '❌ Error obteniendo el estado del sistema.';
			await this.sendMessage(chatId, text);
		}
	}

	// NUEVO: Comando para configurar preferencias
	async handleSettings(chatId, args, msg, user) {
		const lang = user.preferences.language;

		if (args.length === 0) {
			// Mostrar configuración actual
			const texts =
				lang === 'en'
					? {
							title: 'Your Settings',
							language: 'Language',
							timezone: 'Timezone',
							notifications: 'Notifications',
							cooldown: 'Alert cooldown',
							quietHours: 'Quiet hours',
							enabled: 'Enabled',
							disabled: 'Disabled',
							minutes: 'minutes',
							usage: 'Usage',
							examples: 'Examples',
						}
					: {
							title: 'Tu Configuración',
							language: 'Idioma',
							timezone: 'Zona horaria',
							notifications: 'Notificaciones',
							cooldown: 'Cooldown de alertas',
							quietHours: 'Horas silenciosas',
							enabled: 'Habilitado',
							disabled: 'Deshabilitado',
							minutes: 'minutos',
							usage: 'Uso',
							examples: 'Ejemplos',
						};

			const quietHours = user.preferences.notifications.quietHours.enabled
				? `${texts.enabled} (${user.preferences.notifications.quietHours.start} - ${user.preferences.notifications.quietHours.end})`
				: texts.disabled;

			const message = `⚙️ <b>${texts.title}</b>

🌐 <b>${texts.language}:</b> ${user.preferences.language.toUpperCase()}
🕐 <b>${texts.timezone}:</b> ${user.preferences.timezone}
🔔 <b>${texts.notifications}:</b> ${user.preferences.notifications.enabled ? texts.enabled : texts.disabled}
⏰ <b>${texts.cooldown}:</b> ${user.preferences.notifications.cooldownMinutes} ${texts.minutes}
🔇 <b>${texts.quietHours}:</b> ${quietHours}

<b>${texts.usage}:</b>
• /settings lang en
• /settings timezone America/Argentina/Buenos_Aires
• /settings notifications off
• /settings cooldown 90
• /settings quiet 23:00-07:00

<b>${texts.examples}:</b>
• /settings quiet off
• /settings lang es`;

			await this.sendMessage(chatId, message);
			return;
		}

		// Procesar configuración
		const setting = args[0].toLowerCase();
		const value = args.slice(1).join(' ');

		try {
			let updated = false;
			let responseMessage = '';

			switch (setting) {
				case 'lang':
				case 'language':
					if (['es', 'en'].includes(value)) {
						user.preferences.language = value;
						updated = true;
						responseMessage =
							value === 'en'
								? `✅ Language updated to English`
								: `✅ Idioma actualizado a Español`;
					} else {
						responseMessage =
							lang === 'en'
								? '❌ Invalid language. Use: es or en'
								: '❌ Idioma inválido. Usa: es o en';
					}
					break;

				case 'timezone':
					// Validación básica de timezone
					if (value && value.includes('/')) {
						user.preferences.timezone = value;
						updated = true;
						responseMessage =
							lang === 'en'
								? `✅ Timezone updated to ${value}`
								: `✅ Zona horaria actualizada a ${value}`;
					} else {
						responseMessage =
							lang === 'en'
								? '❌ Invalid timezone. Example: Europe/Berlin'
								: '❌ Zona horaria inválida. Ejemplo: Europe/Berlin';
					}
					break;

				case 'notifications':
					if (['on', 'off', 'true', 'false'].includes(value.toLowerCase())) {
						const enabled = ['on', 'true'].includes(value.toLowerCase());
						user.preferences.notifications.enabled = enabled;
						updated = true;
						responseMessage =
							lang === 'en'
								? `✅ Notifications ${enabled ? 'enabled' : 'disabled'}`
								: `✅ Notificaciones ${enabled ? 'habilitadas' : 'deshabilitadas'}`;
					} else {
						responseMessage =
							lang === 'en'
								? '❌ Invalid value. Use: on/off'
								: '❌ Valor inválido. Usa: on/off';
					}
					break;

				case 'cooldown':
					const cooldown = parseInt(value);
					if (!isNaN(cooldown) && cooldown >= 15 && cooldown <= 480) {
						user.preferences.notifications.cooldownMinutes = cooldown;
						updated = true;
						responseMessage =
							lang === 'en'
								? `✅ Cooldown updated to ${cooldown} minutes`
								: `✅ Cooldown actualizado a ${cooldown} minutos`;
					} else {
						responseMessage =
							lang === 'en'
								? '❌ Invalid cooldown. Range: 15-480 minutes'
								: '❌ Cooldown inválido. Rango: 15-480 minutos';
					}
					break;

				case 'quiet':
					if (value.toLowerCase() === 'off') {
						user.preferences.notifications.quietHours.enabled = false;
						updated = true;
						responseMessage =
							lang === 'en'
								? '✅ Quiet hours disabled'
								: '✅ Horas silenciosas deshabilitadas';
					} else if (value.match(/^\d{2}:\d{2}-\d{2}:\d{2}$/)) {
						const [start, end] = value.split('-');
						user.preferences.notifications.quietHours.enabled = true;
						user.preferences.notifications.quietHours.start = start;
						user.preferences.notifications.quietHours.end = end;
						updated = true;
						responseMessage =
							lang === 'en'
								? `✅ Quiet hours set: ${start} - ${end}`
								: `✅ Horas silenciosas configuradas: ${start} - ${end}`;
					} else {
						responseMessage =
							lang === 'en'
								? '❌ Invalid format. Use: 23:00-07:00 or off'
								: '❌ Formato inválido. Usa: 23:00-07:00 o off';
					}
					break;

				default:
					responseMessage =
						lang === 'en'
							? '❌ Unknown setting. Use /settings to see options'
							: '❌ Configuración desconocida. Usa /settings para ver opciones';
			}

			if (updated) {
				await user.save();
			}

			await this.sendMessage(chatId, responseMessage);
		} catch (error) {
			console.error('❌ Error actualizando configuración:', error);
			const text =
				lang === 'en'
					? '❌ Error updating settings.'
					: '❌ Error actualizando configuración.';
			await this.sendMessage(chatId, text);
		}
	}

	async handlePauseMonitor(chatId, args, msg, user) {
		const lang = user.preferences.language;

		if (args.length === 0) {
			const text =
				lang === 'en'
					? '❌ Missing monitor ID.\n\nUsage: /pause [ID]\nExample: /pause 507f1f77bcf86cd799439011\n\nUse /monitors to see available IDs.'
					: '❌ Falta el ID del monitor.\n\nUso: /pause [ID]\nEjemplo: /pause 507f1f77bcf86cd799439011\n\nUsa /monitors para ver los IDs disponibles.';
			await this.sendMessage(chatId, text);
			return;
		}

		const monitorId = args[0];

		try {
			// NUEVO: Solo buscar monitores del usuario
			const monitor = await RouteMonitor.findOne({
				_id: monitorId,
				userId: user._id,
			});

			if (!monitor) {
				const text =
					lang === 'en'
						? '❌ Monitor not found or not yours. Check the ID with /monitors'
						: '❌ Monitor no encontrado o no es tuyo. Verifica el ID con /monitors';
				await this.sendMessage(chatId, text);
				return;
			}

			if (!monitor.isActive) {
				const text =
					lang === 'en'
						? `⏸️ The monitor "${monitor.name}" is already paused.`
						: `⏸️ El monitor "${monitor.name}" ya está pausado.`;
				await this.sendMessage(chatId, text);
				return;
			}

			monitor.isActive = false;
			await monitor.save();

			const texts =
				lang === 'en'
					? {
							title: 'Monitor Paused',
							route: 'Route',
							threshold: 'Threshold',
							message:
								'The monitor will stop checking prices until you reactivate it with:',
						}
					: {
							title: 'Monitor Pausado',
							route: 'Ruta',
							threshold: 'Umbral',
							message:
								'El monitor dejará de verificar precios hasta que lo reactives con:',
						};

			const message = `⏸️ <b>${texts.title}</b>

📍 <b>${texts.route}:</b> ${monitor.name}
🛫 ${monitor.origin} → ${monitor.destination}
💰 ${texts.threshold}: €${monitor.priceThreshold}

${texts.message}
<code>/resume ${monitorId}</code>`;

			await this.sendMessage(chatId, message);

			console.log(
				`⏸️ Monitor pausado por ${user.firstName}: ${monitor.name} (${monitorId})`
			);
		} catch (error) {
			console.error('❌ Error pausando monitor:', error);

			let text;
			if (error.name === 'CastError') {
				text =
					lang === 'en'
						? '❌ Invalid monitor ID format. Check the format with /monitors'
						: '❌ ID de monitor inválido. Verifica el formato con /monitors';
			} else {
				text =
					lang === 'en'
						? '❌ Error pausing monitor. Please try again.'
						: '❌ Error pausando el monitor. Intenta nuevamente.';
			}
			await this.sendMessage(chatId, text);
		}
	}

	async handleResumeMonitor(chatId, args, msg, user) {
		const lang = user.preferences.language;

		if (args.length === 0) {
			const text =
				lang === 'en'
					? '❌ Missing monitor ID.\n\nUsage: /resume [ID]\nExample: /resume 507f1f77bcf86cd799439011\n\nUse /monitors to see available IDs.'
					: '❌ Falta el ID del monitor.\n\nUso: /resume [ID]\nEjemplo: /resume 507f1f77bcf86cd799439011\n\nUsa /monitors para ver los IDs disponibles.';
			await this.sendMessage(chatId, text);
			return;
		}

		const monitorId = args[0];

		try {
			// NUEVO: Solo buscar monitores del usuario
			const monitor = await RouteMonitor.findOne({
				_id: monitorId,
				userId: user._id,
			});

			if (!monitor) {
				const text =
					lang === 'en'
						? '❌ Monitor not found or not yours. Check the ID with /monitors'
						: '❌ Monitor no encontrado o no es tuyo. Verifica el ID con /monitors';
				await this.sendMessage(chatId, text);
				return;
			}

			if (monitor.isActive) {
				const text =
					lang === 'en'
						? `✅ The monitor "${monitor.name}" is already active.`
						: `✅ El monitor "${monitor.name}" ya está activo.`;
				await this.sendMessage(chatId, text);
				return;
			}

			monitor.isActive = true;
			await monitor.save();

			const texts =
				lang === 'en'
					? {
							title: 'Monitor Reactivated',
							route: 'Route',
							threshold: 'Threshold',
							message:
								'The monitor will start checking prices again in the next monitoring cycle.',
							pauseAgain: 'To pause it again use:',
						}
					: {
							title: 'Monitor Reactivado',
							route: 'Ruta',
							threshold: 'Umbral',
							message:
								'El monitor volverá a verificar precios en el próximo ciclo de monitoreo.',
							pauseAgain: 'Para pausarlo nuevamente usa:',
						};

			const message = `✅ <b>${texts.title}</b>

📍 <b>${texts.route}:</b> ${monitor.name}
🛫 ${monitor.origin} → ${monitor.destination}
💰 ${texts.threshold}: €${monitor.priceThreshold}

${texts.message}

${texts.pauseAgain}
<code>/pause ${monitorId}</code>`;

			await this.sendMessage(chatId, message);

			console.log(
				`✅ Monitor reactivado por ${user.firstName}: ${monitor.name} (${monitorId})`
			);
		} catch (error) {
			console.error('❌ Error reactivando monitor:', error);

			let text;
			if (error.name === 'CastError') {
				text =
					lang === 'en'
						? '❌ Invalid monitor ID format. Check the format with /monitors'
						: '❌ ID de monitor inválido. Verifica el formato con /monitors';
			} else {
				text =
					lang === 'en'
						? '❌ Error reactivating monitor. Please try again.'
						: '❌ Error reactivando el monitor. Intenta nuevamente.';
			}
			await this.sendMessage(chatId, text);
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

	formatDate(date, user) {
		if (!date) return user.preferences.language === 'en' ? 'N/A' : 'N/D';

		const now = new Date();
		const diffMs = now - new Date(date);
		const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
		const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

		const lang = user.preferences.language;

		if (diffHours < 1) {
			const text = lang === 'en' ? 'ago' : 'Hace';
			const minutes = lang === 'en' ? 'm' : 'm';
			return `${text} ${diffMinutes}${minutes}`;
		} else if (diffHours < 24) {
			const text = lang === 'en' ? 'ago' : 'Hace';
			const hours = lang === 'en' ? 'h' : 'h';
			const minutes = lang === 'en' ? 'm' : 'm';
			return `${text} ${diffHours}${hours} ${diffMinutes}${minutes}`;
		} else {
			const locale = lang === 'en' ? 'en-US' : 'es-ES';
			return new Date(date).toLocaleDateString(locale, {
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
