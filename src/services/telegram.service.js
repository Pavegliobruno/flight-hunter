const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Singleton instance
let instance = null;

class TelegramService {
	constructor() {
		// Singleton pattern - si ya existe una instancia, retornarla
		if (instance) {
			return instance;
		}

		this.bot = null;
		this.defaultChatId = process.env.TELEGRAM_CHAT_ID;
		this.sentAlerts = new Set();
		this.commandsService = null;

		if (process.env.TELEGRAM_BOT_TOKEN) {
			this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
				polling: true,
			});

			this.initializeCommands();

			console.log('📱 Telegram bot inicializado (singleton)');
		} else {
			console.warn('⚠️  TELEGRAM_BOT_TOKEN no configurado');
		}

		instance = this;
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
			{command: 'start', description: 'Iniciar el bot'},
			{command: 'create', description: 'Crear nuevo monitor'},
			{command: 'monitors', description: 'Ver y gestionar monitores'},
			{command: 'help', description: 'Ayuda'},
			{command: 'cancel', description: 'Cancelar operación en curso'},
		]);

		// Set para trackear mensajes ya procesados (evita duplicados)
		this.processedMessages = new Set();

		this.bot.on('message', async (msg) => {
			// Evitar procesar el mismo mensaje dos veces
			const msgKey = `${msg.chat.id}_${msg.message_id}`;
			if (this.processedMessages.has(msgKey)) {
				return;
			}
			this.processedMessages.add(msgKey);

			// Limpiar cache cada 1000 mensajes
			if (this.processedMessages.size > 1000) {
				this.processedMessages.clear();
			}

			try {
				// Si es un comando
				if (msg.text?.startsWith('/')) {
					const match = msg.text.match(/\/(\w+)(.*)/);
					if (match && this.commandsService) {
						console.log(`📱 Comando: ${match[1]}`);
						await this.commandsService.handleCommand(msg, match);
					}
					return;
				}

				// Si no es comando, verificar conversación activa
				if (this.commandsService) {
					const handled = await this.commandsService.handleMessage(msg);
					if (handled) return;
				}

				// Solo enviar saludo si no hay conversación activa
				this.bot.sendMessage(
					msg.chat.id,
					'Usa /help para ver los comandos disponibles.'
				);
			} catch (error) {
				console.error('❌ Error procesando mensaje:', error);
			}
		});

		// Manejar callback queries (botones inline)
		this.bot.on('callback_query', async (callbackQuery) => {
			try {
				if (this.commandsService) {
					await this.commandsService.handleCallbackQuery(callbackQuery);
				}
			} catch (error) {
				console.error('❌ Error en callback query:', error);
			}
		});

		// Manejar errores del bot
		this.bot.on('polling_error', (error) => {
			console.error('❌ Telegram polling error:', error.code, error.message);
		});

		console.log('🤖 Comandos de Telegram configurados exitosamente');
	}

	async sendPriceAlert(flight, routeMonitor) {
		if (!this.bot) {
			console.log('❌ Bot de Telegram no configurado');
			return false;
		}

		const flightKey = `${routeMonitor._id}_${flight.departure.date.toDateString()}_${Math.round(flight.price.amount)}`;

		if (this.sentAlerts.has(flightKey)) {
			console.log(
				`⏭️  Vuelo duplicado evitado: ${flight.origin.code} → ${flight.destination.code} €${flight.price.amount}`
			);
			return false;
		}

		try {
			const chatId =
				routeMonitor.notifications.telegram.chatId || this.defaultChatId;
			if (!chatId) return false;

			const message = this.formatPriceAlert(flight, routeMonitor);
			let bookingUrl = flight.bookingUrl || 'https://kiwi.com';
			if (bookingUrl.startsWith('/')) {
				bookingUrl = 'https://kiwi.com' + bookingUrl;
			}

			// Generar links alternativos
			const altLinks = this.generateAlternativeLinks(flight);

			const options = {
				parse_mode: 'HTML',
				disable_web_page_preview: false,
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: '🥝 Kiwi',
								url: bookingUrl,
							},
							{
								text: '🔵 Skyscanner',
								url: altLinks.skyscanner,
							},
							{
								text: '🟠 Kayak',
								url: altLinks.kayak,
							},
						],
					],
				},
			};

			await this.bot.sendMessage(chatId, message, options);

			//  Marcar como enviado
			this.sentAlerts.add(flightKey);

			// Limpiar cache cada 100 alertas para no consumir mucha memoria
			if (this.sentAlerts.size > 100) {
				this.sentAlerts.clear();
				console.log('🧹 Cache de duplicados limpiado');
			}

			console.log(
				`📱 Alerta enviada: ${flight.origin.code} → ${flight.destination.code} - €${flight.price.amount}`
			);
			return true;
		} catch (error) {
			console.error('❌ Error enviando mensaje de Telegram:', error.message);
			return false;
		}
	}

	formatPriceAlert(flight, routeMonitor) {
		const isNewLow =
			!routeMonitor.bestPrice ||
			flight.price.amount < routeMonitor.bestPrice.amount;

		if (flight.returnFlight) {
			// Calcular días del viaje
			const departureDate = new Date(flight.departure?.date);
			const returnDate = new Date(flight.returnFlight.departure?.date);
			const tripDays = Math.round((returnDate - departureDate) / (1000 * 60 * 60 * 24));

			const outboundDuration =
				this.calculateFlightDuration(flight.departure, flight.arrival) ||
				this.formatDuration(flight.duration?.minutes || flight.duration?.total);

			const returnDuration =
				this.calculateReturnDuration(flight.returnFlight) ||
				this.formatDuration(flight.returnFlight.duration?.minutes);

			const outboundStops = flight.isDirect
				? 'Directo'
				: `${flight.numberOfStops} escala${flight.numberOfStops > 1 ? 's' : ''}`;

			const returnStops = flight.returnFlight.isDirect
				? 'Directo'
				: `${flight.returnFlight.numberOfStops || 0} escala${(flight.returnFlight.numberOfStops || 0) > 1 ? 's' : ''}`;

			return `<b>€${Math.round(flight.price.amount)}</b> - ${flight.origin.city} → ${flight.destination.city}${isNewLow ? ' 🔥' : ''}

<b>Ida:</b> ${this.formatDateShort(flight.departure?.date)} ${this.formatTime(flight.departure?.time)} · ${outboundDuration} · ${outboundStops}
<b>Vuelta:</b> ${this.formatDateShort(flight.returnFlight.departure?.date)} ${this.formatTime(flight.returnFlight.departure?.time)} · ${returnDuration} · ${returnStops}

📅 <b>${tripDays} días</b> · Umbral: €${routeMonitor.priceThreshold}
<i>${routeMonitor.name}</i>`;
		} else {
			// Solo ida
			const flightDuration =
				this.calculateFlightDuration(flight.departure, flight.arrival) ||
				this.formatDuration(flight.duration?.minutes || flight.duration?.total);

			const flightStops = flight.isDirect
				? 'Directo'
				: `${flight.numberOfStops} escala${flight.numberOfStops > 1 ? 's' : ''}`;

			return `<b>€${Math.round(flight.price.amount)}</b> - ${flight.origin.city} → ${flight.destination.city}${isNewLow ? ' 🔥' : ''}

<b>Ida:</b> ${this.formatDateShort(flight.departure?.date)} ${this.formatTime(flight.departure?.time)} · ${flightDuration} · ${flightStops}

Umbral: €${routeMonitor.priceThreshold}
<i>${routeMonitor.name}</i>`;
		}
	}

	formatDateShort(date) {
		if (!date) return 'N/A';
		return new Date(date).toLocaleDateString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
		});
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

	formatDate(date) {
		return new Date(date).toLocaleDateString('es-ES', {
			weekday: 'short',
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	}

	generateAlternativeLinks(flight) {
		const origin = flight.origin.code;
		const destination = flight.destination.code;
		const departureDate = new Date(flight.departure.date);
		const returnDate = flight.returnFlight?.departure?.date
			? new Date(flight.returnFlight.departure.date)
			: null;

		// Formato YYMMDD para Skyscanner
		const formatSkyscanner = (date) => {
			const yy = date.getFullYear().toString().slice(-2);
			const mm = (date.getMonth() + 1).toString().padStart(2, '0');
			const dd = date.getDate().toString().padStart(2, '0');
			return `${yy}${mm}${dd}`;
		};

		// Formato YYYY-MM-DD para Google y Kayak
		const formatISO = (date) => {
			return date.toISOString().split('T')[0];
		};

		const depSkyscanner = formatSkyscanner(departureDate);
		const depISO = formatISO(departureDate);

		const links = {};

		if (returnDate) {
			// Ida y vuelta
			const retSkyscanner = formatSkyscanner(returnDate);
			const retISO = formatISO(returnDate);

			links.skyscanner = `https://www.skyscanner.com/transport/flights/${origin.toLowerCase()}/${destination.toLowerCase()}/${depSkyscanner}/${retSkyscanner}/?currency=EUR`;
			links.kayak = `https://www.kayak.com/flights/${origin}-${destination}/${depISO}/${retISO}?sort=bestflight_a&currency=EUR`;
		} else {
			// Solo ida
			links.skyscanner = `https://www.skyscanner.com/transport/flights/${origin.toLowerCase()}/${destination.toLowerCase()}/${depSkyscanner}/?currency=EUR`;
			links.kayak = `https://www.kayak.com/flights/${origin}-${destination}/${depISO}?sort=bestflight_a&currency=EUR`;
		}

		return links;
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
