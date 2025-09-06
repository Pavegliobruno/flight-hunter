const TelegramBot = require('node-telegram-bot-api');
const User = require('../models/user.model');
require('dotenv').config();

class TelegramService {
	constructor() {
		this.bot = null;
		this.defaultChatId = process.env.TELEGRAM_CHAT_ID;
		this.sentAlerts = new Map();
		this.commandsService = null;

		if (process.env.TELEGRAM_BOT_TOKEN) {
			this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
				polling: true,
			});

			this.initializeCommands();
			console.log('📱 Telegram bot inicializado');
		} else {
			console.warn('⚠️  TELEGRAM_BOT_TOKEN no configurado');
		}
	}

	initializeCommands() {
		if (!this.bot) return;

		const TelegramCommandsService = require('./telegramCommands.service');
		this.commandsService = new TelegramCommandsService(this);
		this.setupCommands();
	}

	setupCommands() {
		if (!this.bot || !this.commandsService) return;

		this.bot.setMyCommands([
			{command: 'start', description: 'Iniciar el bot y registrarse'},
			{command: 'help', description: 'Mostrar ayuda y comandos disponibles'},
			{command: 'monitors', description: 'Ver tus rutas monitoreadas'},
			{command: 'status', description: 'Ver tu estado y estadísticas'},
			{command: 'settings', description: 'Configurar preferencias'},
			{command: 'pause', description: 'Pausar un monitor específico'},
			{command: 'resume', description: 'Reactivar un monitor pausado'},
		]);

		this.bot.onText(/\/(\w+)(.*)/, async (msg, match) => {
			try {
				console.log(
					`📱 Comando recibido de ${msg.from.first_name} (@${msg.from.username}): ${match[1]}`
				);

				const user = await User.findOrCreate(msg.from);
				await this.commandsService.handleCommand(msg, match, user);
			} catch (error) {
				console.error('❌ Error manejando comando:', error);
				await this.bot.sendMessage(
					msg.chat.id,
					'❌ Error procesando el comando. Intenta nuevamente.'
				);
			}
		});

		this.bot.on('message', async (msg) => {
			try {
				if (!msg.text?.startsWith('/')) {
					const user = await User.findOrCreate(msg.from);

					await this.bot.sendMessage(
						msg.chat.id,
						`👋 ¡Hola ${user.firstName}! Soy el bot de monitoreo de vuelos.\n\n` +
							'Usa /help para ver los comandos disponibles o /monitors para ver tus rutas monitoreadas.'
					);
				}
			} catch (error) {
				console.error('❌ Error procesando mensaje:', error);
			}
		});

		this.bot.on('polling_error', (error) => {
			console.error('❌ Telegram polling error:', error.code, error.message);
		});

		console.log('🤖 Comandos de Telegram configurados exitosamente');
	}

	async sendPriceAlert(flight, routeMonitor, user) {
		if (!this.bot) {
			console.log('❌ Bot de Telegram no configurado');
			return false;
		}

		const alertKey = this.generateAlertKey(flight, routeMonitor, user);

		if (this.isDuplicateAlert(alertKey, routeMonitor)) {
			console.log(
				`⏭️  Alerta duplicada evitada: ${flight.origin.code} → ${flight.destination.code} €${flight.price.amount} (Usuario: ${user.firstName})`
			);
			return false;
		}

		try {
			// Verificar límites del usuario
			if (!user.canReceiveAlert()) {
				console.log(
					`🚫 Usuario ${user.firstName} ha alcanzado el límite de alertas diarias`
				);
				return false;
			}

			// Verificar horas silenciosas
			if (user.isInQuietHours()) {
				console.log(`🔇 Usuario ${user.firstName} está en horas silenciosas`);
				return false;
			}

			if (!this.canSendAlert(routeMonitor)) {
				console.log(
					`⏰ Monitor en cooldown: ${routeMonitor.name} (Usuario: ${user.firstName})`
				);
				return false;
			}

			const chatId = user.telegramId;
			const message = this.formatPriceAlert(flight, routeMonitor, user);
			let bookingUrl = flight.bookingUrl || 'https://kiwi.com';
			if (bookingUrl.startsWith('/')) {
				bookingUrl = 'https://kiwi.com' + bookingUrl;
			}

			const options = {
				parse_mode: 'HTML',
				disable_web_page_preview: false,
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '🔗 Ver en Kiwi',
								url: bookingUrl,
							},
							{
								text: '📊 Mis Stats',
								callback_data: `user_stats_${user._id}`,
							},
						],
						[
							{
								text: '⏸️ Pausar Monitor',
								callback_data: `pause_${routeMonitor._id}`,
							},
							{
								text: '📋 Mis Monitores',
								callback_data: `my_monitors_${user._id}`,
							},
						],
						[
							{
								text: '⚙️ Configuración',
								callback_data: `settings_${user._id}`,
							},
						],
					],
				},
			};

			await this.bot.sendMessage(chatId, message, options);

			this.markAlertAsSent(alertKey);

			// Incrementar contador de alertas del usuario
			await user.incrementAlertCount();

			// Actualizar mejor deal si corresponde
			if (
				!user.stats.bestDealFound ||
				flight.price.amount < user.stats.bestDealFound.amount
			) {
				user.stats.bestDealFound = {
					amount: flight.price.amount,
					currency: flight.price.currency,
					route: `${flight.origin.code}-${flight.destination.code}`,
					foundAt: new Date(),
				};
				await user.save();
			}

			this.cleanupAlertCache();

			console.log(
				`📱 Alerta enviada a ${user.firstName}: ${flight.origin.code} → ${flight.destination.code} - €${flight.price.amount}`
			);
			return true;
		} catch (error) {
			console.error('❌ Error enviando mensaje de Telegram:', error.message);
			return false;
		}
	}

	generateAlertKey(flight, routeMonitor, user) {
		const date = flight.departure?.date
			? new Date(flight.departure.date).toISOString().split('T')[0]
			: 'unknown';
		const priceRange = Math.floor(flight.price.amount / 10) * 10;

		return `${user.telegramId}_${routeMonitor._id}_${flight.origin.code}_${flight.destination.code}_${date}_${priceRange}`;
	}

	isDuplicateAlert(alertKey, routeMonitor) {
		const now = Date.now();
		const alertData = this.sentAlerts.get(alertKey);

		if (!alertData) {
			return false;
		}

		const cooldownMs =
			(routeMonitor.notifications.telegram.cooldownMinutes || 60) * 60 * 1000;
		const timeSinceLastAlert = now - alertData.timestamp;

		return timeSinceLastAlert < cooldownMs;
	}

	canSendAlert(routeMonitor) {
		if (!routeMonitor.notifications.telegram.lastSent) {
			return true;
		}

		const now = new Date();
		const lastSent = new Date(routeMonitor.notifications.telegram.lastSent);
		const cooldownMs =
			(routeMonitor.notifications.telegram.cooldownMinutes || 60) * 60 * 1000;

		return now - lastSent >= cooldownMs;
	}

	markAlertAsSent(alertKey) {
		this.sentAlerts.set(alertKey, {
			timestamp: Date.now(),
			count: (this.sentAlerts.get(alertKey)?.count || 0) + 1,
		});
	}

	cleanupAlertCache() {
		const now = Date.now();
		const maxAge = 24 * 60 * 60 * 1000;

		if (this.sentAlerts.size > 100 && this.sentAlerts.size % 100 === 0) {
			console.log(
				`🧹 Limpiando cache de alertas (${this.sentAlerts.size} entradas)`
			);

			for (const [key, data] of this.sentAlerts.entries()) {
				if (now - data.timestamp > maxAge) {
					this.sentAlerts.delete(key);
				}
			}

			console.log(
				`🧹 Cache limpiado. Entradas restantes: ${this.sentAlerts.size}`
			);
		}

		if (this.sentAlerts.size > 1000) {
			console.log('🧹 Forzando limpieza completa del cache');
			this.sentAlerts.clear();
		}
	}

	getAlertStats() {
		const stats = {
			totalAlerts: this.sentAlerts.size,
			alertsByUser: {},
			recentAlerts: [],
		};

		const now = Date.now();
		const oneHourAgo = now - 60 * 60 * 1000;

		for (const [key, data] of this.sentAlerts.entries()) {
			const [userId] = key.split('_');
			stats.alertsByUser[userId] = (stats.alertsByUser[userId] || 0) + 1;

			if (data.timestamp > oneHourAgo) {
				stats.recentAlerts.push({
					key,
					timestamp: new Date(data.timestamp),
					count: data.count,
				});
			}
		}

		return stats;
	}

	formatPriceAlert(flight, routeMonitor, user) {
		const isNewLow =
			!routeMonitor.bestPrice ||
			flight.price.amount < routeMonitor.bestPrice.amount;

		let priceChange = '';
		if (
			routeMonitor.bestPrice?.amount &&
			!isNaN(routeMonitor.bestPrice.amount)
		) {
			const diff = flight.price.amount - routeMonitor.bestPrice.amount;
			priceChange =
				diff !== 0 ? ` (${diff > 0 ? '+' : ''}€${Math.round(diff)})` : '';
		}

		const lang = user.preferences.language;
		const texts = this.getTexts(lang);

		const title = `€${Math.round(flight.price.amount)} - ${flight.origin.city} → ${flight.destination.city}`;

		const timestamp = new Date().toLocaleTimeString('es-ES', {
			hour: '2-digit',
			minute: '2-digit',
		});

		if (flight.returnFlight) {
			const outboundDuration =
				this.calculateFlightDuration(flight.departure, flight.arrival) ||
				this.formatDuration(flight.duration?.minutes || flight.duration?.total);

			const returnDuration =
				this.calculateReturnDuration(flight.returnFlight) ||
				this.formatDuration(flight.returnFlight.duration?.minutes);

			const outboundInfo = flight.isDirect
				? `${outboundDuration} • ${texts.direct}`
				: `${outboundDuration} • ${flight.numberOfStops} ${texts.stops}`;

			const returnInfo = flight.returnFlight.isDirect
				? `${returnDuration} • ${texts.direct}`
				: `${returnDuration} • ${flight.returnFlight.numberOfStops || 0} ${texts.stops}`;

			return `🔥 <b>${title}</b>${priceChange}

🛫 <b>${texts.outbound}:</b> ${flight.origin.city} → ${flight.destination.city}
📅 <b>${this.formatDate(flight.departure?.date, user)}</b> ${texts.at} <b>${this.formatTime(flight.departure?.time)}</b>
⏱️ ${outboundInfo}

🛬 <b>${texts.return}:</b> ${flight.destination.city} → ${flight.origin.city}
📅 <b>${this.formatDate(flight.returnFlight.departure?.date, user)}</b> ${texts.at} <b>${this.formatTime(flight.returnFlight.departure?.time)}</b>
⏱️ ${returnInfo}

💰 <b>${texts.totalPrice}: €${Math.round(flight.price?.amount)}</b>${priceChange}

${isNewLow ? `🏆 <b>${texts.newMinimum}!</b>` : ''}
🎯 <b>${texts.threshold}:</b> €${routeMonitor.priceThreshold}

<i>${texts.route}: ${routeMonitor.name}</i>
<i>⏰ ${timestamp}</i>`;
		} else {
			// Solo ida
			const flightDuration =
				this.calculateFlightDuration(flight.departure, flight.arrival) ||
				this.formatDuration(flight.duration?.minutes || flight.duration?.total);

			const flightInfo = flight.isDirect
				? `${flightDuration} • ${texts.direct}`
				: `${flightDuration} • ${flight.numberOfStops} ${texts.stops}`;

			return `🔥 <b>${title}</b>${priceChange}

🛫 ${flight.origin.city} → ${flight.destination.city}
📅 <b>${this.formatDate(flight.departure?.date, user)}</b> ${texts.at} <b>${this.formatTime(flight.departure?.time)}</b>
⏱️ ${flightInfo}

💰 <b>${texts.price}: €${Math.round(flight.price?.amount)}</b>${priceChange}

${isNewLow ? `🏆 <b>${texts.newMinimum}!</b>` : ''}
🎯 <b>${texts.threshold}:</b> €${routeMonitor.priceThreshold}

<i>${texts.route}: ${routeMonitor.name}</i>
<i>⏰ ${timestamp}</i>`;
		}
	}

	getTexts(lang) {
		const texts = {
			es: {
				outbound: 'IDA',
				return: 'VUELTA',
				direct: 'Directo',
				stops: 'escalas',
				at: 'a las',
				totalPrice: 'PRECIO TOTAL',
				price: 'PRECIO',
				newMinimum: '¡NUEVO PRECIO MÍNIMO!',
				threshold: 'Umbral',
				route: 'Ruta',
			},
			en: {
				outbound: 'OUTBOUND',
				return: 'RETURN',
				direct: 'Direct',
				stops: 'stops',
				at: 'at',
				totalPrice: 'TOTAL PRICE',
				price: 'PRICE',
				newMinimum: '¡NEW MINIMUM PRICE!',
				threshold: 'Threshold',
				route: 'Route',
			},
		};

		return texts[lang] || texts.es;
	}

	calculateFlightDuration(departure, arrival) {
		if (!departure || !arrival) return null;

		try {
			const depTime = departure.timestamp || new Date(departure.date).getTime();
			const arrTime = arrival.timestamp || new Date(arrival.date).getTime();

			if (depTime && arrTime && arrTime > depTime) {
				const durationMinutes = (arrTime - depTime) / (1000 * 60);
				return this.formatDuration(durationMinutes);
			}
		} catch (error) {
			console.log(`⚠️  Error calculando duración: ${error.message}`);
		}

		return null;
	}

	formatTime(timeString) {
		if (!timeString) return 'N/A';

		try {
			if (timeString.includes('T')) {
				const timePart = timeString.split('T')[1];
				if (timePart) {
					return timePart.substring(0, 5);
				}
			}

			if (timeString.match(/^\d{2}:\d{2}/)) {
				return timeString.substring(0, 5);
			}

			return timeString;
		} catch (error) {
			return 'N/A';
		}
	}

	calculateReturnDuration(returnFlight) {
		if (!returnFlight || !returnFlight.departure || !returnFlight.arrival) {
			return null;
		}

		return this.calculateFlightDuration(
			returnFlight.departure,
			returnFlight.arrival
		);
	}

	formatDuration(durationInput) {
		if (!durationInput) return 'N/A';

		try {
			let minutes;

			if (typeof durationInput === 'string') {
				const match = durationInput.match(/(\d+)h\s*(\d+)m/);
				if (match) {
					const hours = parseInt(match[1]);
					const mins = parseInt(match[2]);
					minutes = hours * 60 + mins;
				} else {
					return durationInput;
				}
			} else if (typeof durationInput === 'number') {
				minutes = durationInput;
			} else {
				return 'N/A';
			}

			if (isNaN(minutes) || minutes <= 0 || minutes > 1440) {
				return 'N/A';
			}

			const hours = Math.floor(minutes / 60);
			const mins = Math.round(minutes % 60);
			return `${hours}h ${mins}m`;
		} catch (error) {
			console.log(`⚠️  Error formateando duración: ${error.message}`);
			return 'N/A';
		}
	}

	formatDate(date, user) {
		const locale = user?.preferences?.language === 'en' ? 'en-US' : 'es-ES';

		return new Date(date).toLocaleDateString(locale, {
			weekday: 'short',
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	}

	async sendUserStats(user) {
		if (!this.bot) return false;

		try {
			const lang = user.preferences.language;
			const texts =
				lang === 'en'
					? {
							title: 'Your Flight Monitoring Stats',
							monitors: 'Monitors',
							active: 'Active',
							total: 'Total',
							alerts: 'Alerts received',
							bestDeal: 'Best deal found',
							registered: 'Member since',
							settings: 'Settings',
							timezone: 'Timezone',
							notifications: 'Notifications',
							cooldown: 'Cooldown',
							quietHours: 'Quiet hours',
							enabled: 'Enabled',
							disabled: 'Disabled',
							minutes: 'min',
							never: 'Never',
						}
					: {
							title: 'Tus Estadísticas de Monitoreo',
							monitors: 'Monitores',
							active: 'Activos',
							total: 'Total',
							alerts: 'Alertas recibidas',
							bestDeal: 'Mejor oferta encontrada',
							registered: 'Miembro desde',
							settings: 'Configuración',
							timezone: 'Zona horaria',
							notifications: 'Notificaciones',
							cooldown: 'Cooldown',
							quietHours: 'Horas silenciosas',
							enabled: 'Habilitado',
							disabled: 'Deshabilitado',
							minutes: 'min',
							never: 'Nunca',
						};

			const bestDeal = user.stats.bestDealFound
				? `€${user.stats.bestDealFound.amount} (${user.stats.bestDealFound.route})`
				: texts.never;

			const quietHours = user.preferences.notifications.quietHours.enabled
				? `${texts.enabled} (${user.preferences.notifications.quietHours.start} - ${user.preferences.notifications.quietHours.end})`
				: texts.disabled;

			const message = `📊 <b>${texts.title}</b>

🔍 <b>${texts.monitors}:</b>
   • ${texts.active}: ${user.stats.activeMonitors}
   • ${texts.total}: ${user.stats.totalMonitors}

🚨 <b>${texts.alerts}:</b> ${user.stats.alertsReceived}
🏆 <b>${texts.bestDeal}:</b> ${bestDeal}

⚙️ <b>${texts.settings}:</b>
   • ${texts.timezone}: ${user.preferences.timezone}
   • ${texts.notifications}: ${user.preferences.notifications.enabled ? texts.enabled : texts.disabled}
   • ${texts.cooldown}: ${user.preferences.notifications.cooldownMinutes} ${texts.minutes}
   • ${texts.quietHours}: ${quietHours}

📅 <b>${texts.registered}:</b> ${this.formatDate(user.registeredAt, user)}`;

			await this.bot.sendMessage(user.telegramId, message, {
				parse_mode: 'HTML',
			});
			return true;
		} catch (error) {
			console.error('❌ Error enviando estadísticas del usuario:', error);
			return false;
		}
	}

	async sendMonitoringStatus(stats) {
		if (!this.bot || !this.defaultChatId) return false;

		try {
			const message = `📊 <b>Estado del Monitoreo de Vuelos</b>

🔍 <b>Rutas activas:</b> ${stats.activeRoutes}
✅ <b>Chequeos hoy:</b> ${stats.checksToday}
🚨 <b>Alertas enviadas:</b> ${stats.alertsToday}
💰 <b>Mejor precio encontrado:</b> €${stats.bestPriceToday?.toFixed(0) || 'N/A'}

⏰ <i>Último reporte: ${new Date().toLocaleString('es-ES')}</i>`;

			await this.bot.sendMessage(this.defaultChatId, message, {
				parse_mode: 'HTML',
			});
			return true;
		} catch (error) {
			console.error('❌ Error enviando estado de monitoreo:', error);
			return false;
		}
	}

	async sendTestMessage() {
		if (!this.bot || !this.defaultChatId) {
			return {success: false, error: 'Bot o Chat ID no configurado'};
		}

		try {
			await this.bot.sendMessage(
				this.defaultChatId,
				'🧪 <b>Test del bot de Kiwi Flight Monitor</b>\n\n✅ ¡El bot está funcionando correctamente!\n\n💡 Usa /help para ver todos los comandos disponibles.',
				{parse_mode: 'HTML'}
			);
			return {success: true, message: 'Mensaje de test enviado'};
		} catch (error) {
			return {success: false, error: error.message};
		}
	}
}

module.exports = TelegramService;
