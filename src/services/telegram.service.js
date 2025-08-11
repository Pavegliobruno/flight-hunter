const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

class TelegramService {
	constructor() {
		this.bot = null;
		this.defaultChatId = process.env.TELEGRAM_CHAT_ID;

		this.sentAlerts = new Set(); // Almacena IDs de vuelos ya enviados

		if (process.env.TELEGRAM_BOT_TOKEN) {
			this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
				polling: false,
			});
			console.log('📱 Telegram bot inicializado');
		} else {
			console.warn('⚠️  TELEGRAM_BOT_TOKEN no configurado');
		}
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
								text: '📊 Estadísticas',
								callback_data: `stats_${routeMonitor._id}`,
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

		let priceChange = '';
		if (
			routeMonitor.bestPrice?.amount &&
			!isNaN(routeMonitor.bestPrice.amount)
		) {
			const diff = flight.price.amount - routeMonitor.bestPrice.amount;
			priceChange =
				diff !== 0 ? ` (${diff > 0 ? '+' : ''}€${Math.round(diff)})` : '';
		}

		const title = `€${Math.round(flight.price.amount)} - ${flight.origin.city} → ${flight.destination.city}`;

		if (flight.returnFlight) {
			const outboundDuration =
				this.calculateFlightDuration(flight.departure, flight.arrival) ||
				this.formatDuration(flight.duration?.minutes || flight.duration?.total);

			const returnDuration =
				this.calculateReturnDuration(flight.returnFlight) ||
				this.formatDuration(flight.returnFlight.duration?.minutes);

			const outboundInfo = flight.isDirect
				? `${outboundDuration} • Directo`
				: `${outboundDuration} • ${flight.numberOfStops} escala${flight.numberOfStops > 1 ? 's' : ''}`;

			const returnInfo = flight.returnFlight.isDirect
				? `${returnDuration} • Directo`
				: `${returnDuration} • ${flight.returnFlight.numberOfStops || 0} escala${(flight.returnFlight.numberOfStops || 0) > 1 ? 's' : ''}`;

			return `🔥 <b>${title}</b>${priceChange}

🛫 <b>IDA:</b> ${flight.origin.city} → ${flight.destination.city}
📅 <b>${this.formatDate(flight.departure?.date)}</b> a las <b>${this.formatTime(flight.departure?.time)}</b>
⏱️ ${outboundInfo}

🛬 <b>VUELTA:</b> ${flight.destination.city} → ${flight.origin.city}
📅 <b>${this.formatDate(flight.returnFlight.departure?.date)}</b> a las <b>${this.formatTime(flight.returnFlight.departure?.time)}</b>
⏱️ ${returnInfo}

💰 <b>PRECIO TOTAL: €${Math.round(flight.price?.amount)}</b>${priceChange}

${isNewLow ? '🏆 <b>¡NUEVO PRECIO MÍNIMO!</b>' : ''}
🎯 <b>Umbral:</b> €${routeMonitor.priceThreshold}

<i>Ruta: ${routeMonitor.name}</i>`;
		} else {
			// Solo ida
			const flightDuration =
				this.calculateFlightDuration(flight.departure, flight.arrival) ||
				this.formatDuration(flight.duration?.minutes || flight.duration?.total);

			const flightInfo = flight.isDirect
				? `${flightDuration} • Directo`
				: `${flightDuration} • ${flight.numberOfStops} escala${flight.numberOfStops > 1 ? 's' : ''}`;

			return `🔥 <b>${title}</b>${priceChange}

🛫 ${flight.origin.city} → ${flight.destination.city}
📅 <b>${this.formatDate(flight.departure?.date)}</b> a las <b>${this.formatTime(flight.departure?.time)}</b>
⏱️ ${flightInfo}

💰 <b>PRECIO: €${Math.round(flight.price?.amount)}</b>${priceChange}

${isNewLow ? '🏆 <b>¡NUEVO PRECIO MÍNIMO!</b>' : ''}
🎯 <b>Umbral:</b> €${routeMonitor.priceThreshold}

<i>Ruta: ${routeMonitor.name}</i>`;
		}
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
			// Si es un timestamp ISO, extraer solo la hora
			if (timeString.includes('T')) {
				const timePart = timeString.split('T')[1];
				if (timePart) {
					return timePart.substring(0, 5); // HH:MM
				}
			}

			// Si ya está en formato HH:MM
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

			// Validar rango razonable
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
				'🧪 Test del bot de Kiwi Flight Monitor\n\n✅ ¡El bot está funcionando correctamente!'
			);
			return {success: true, message: 'Mensaje de test enviado'};
		} catch (error) {
			return {success: false, error: error.message};
		}
	}

	// Método para configurar webhooks si querés comandos interactivos
	setupWebhook(webhookUrl) {
		if (!this.bot) return false;

		this.bot.setWebHook(webhookUrl);

		// Comandos básicos
		this.bot.onText(/\/start/, (msg) => {
			this.bot.sendMessage(
				msg.chat.id,
				'🛫 ¡Bienvenido al Monitor de Vuelos de Kiwi!\n\n' +
					'Recibirás alertas cuando encuentre precios bajos en las rutas que configuraste.\n\n' +
					'Comandos disponibles:\n' +
					'/status - Ver estado del monitoreo\n' +
					'/routes - Ver rutas monitoreadas'
			);
		});

		this.bot.onText(/\/status/, async (msg) => {
			// Aquí podrías consultar stats reales de la DB
			this.bot.sendMessage(
				msg.chat.id,
				'📊 Consultando estado del monitoreo...'
			);
		});

		return true;
	}
}

module.exports = TelegramService;
