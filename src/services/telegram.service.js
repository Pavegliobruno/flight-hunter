const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

class TelegramService {
	constructor() {
		this.bot = null;
		this.defaultChatId = process.env.TELEGRAM_CHAT_ID;

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

		try {
			const chatId =
				routeMonitor.notifications.telegram.chatId || this.defaultChatId;

			if (!chatId) {
				console.error('❌ No hay CHAT_ID configurado para Telegram');
				return false;
			}

			const message = this.formatPriceAlert(flight, routeMonitor);

			// Arreglar la URL del booking - agregar el dominio completo
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
			console.log(
				`📱 Alerta enviada por Telegram: ${flight.origin.code} → ${flight.destination.code} - €${flight.price.amount}`
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

		let emoji = '✈️';
		if (isNewLow) {
			emoji = flight.isDirect ? '🔥🔥🔥 DIRECTO' : '🔥🔥 ESCALA';
		} else {
			emoji = flight.isDirect ? '✈️ DIRECTO' : '✈️ ESCALA';
		}

		let priceChange = '';
		if (
			routeMonitor.bestPrice?.amount &&
			!isNaN(routeMonitor.bestPrice.amount)
		) {
			const diff = flight.price.amount - routeMonitor.bestPrice.amount;
			priceChange =
				diff !== 0 ? ` (${diff > 0 ? '+' : ''}€${Math.round(diff)})` : '';
		}

		// 🔥 INFORMACIÓN DE ESCALAS
		let stopsInfo = '';
		if (flight.isDirect) {
			stopsInfo = '🚀 <b>VUELO DIRECTO</b>';
		} else if (flight.numberOfStops === 1) {
			const stopCity = flight.stops?.[0]?.city || 'Ciudad intermedia';
			stopsInfo = `🔄 <b>1 ESCALA</b> en ${stopCity}`;
		} else if (flight.numberOfStops > 1) {
			stopsInfo = `🔄 <b>${flight.numberOfStops} ESCALAS</b>`;
		}

		// Resto del formato igual...
		let avgPrice = 'N/A';
		if (routeMonitor.stats?.averagePrice) {
			const avg = routeMonitor.stats.averagePrice;
			if (!isNaN(avg) && isFinite(avg) && avg > 0 && avg < 10000) {
				avgPrice = `€${Math.round(avg)}`;
			}
		}

		const isRoundTrip =
			flight.returnFlight || routeMonitor.name.includes('IDA Y VUELTA');

		let flightDetails = '';
		if (isRoundTrip && flight.returnFlight) {
			// Cálculo de duraciones mejorado...
			let outboundDuration = 'N/A';
			if (flight.departure && flight.arrival) {
				const depTime = flight.departure.timestamp;
				const arrTime = flight.arrival.timestamp;
				if (depTime && arrTime && arrTime > depTime) {
					const durationMinutes = (arrTime - depTime) / (1000 * 60);
					if (durationMinutes > 30 && durationMinutes < 720) {
						outboundDuration = this.formatDuration(durationMinutes);
					}
				}
			}

			let returnDuration = 'N/A';
			if (flight.returnFlight.departure && flight.returnFlight.arrival) {
				const depTime = new Date(flight.returnFlight.departure.date).getTime();
				const arrTime = new Date(flight.returnFlight.arrival.date).getTime();
				if (depTime && arrTime && arrTime > depTime) {
					const durationMinutes = (arrTime - depTime) / (1000 * 60);
					if (durationMinutes > 30 && durationMinutes < 720) {
						returnDuration = this.formatDuration(durationMinutes);
					}
				}
			}

			flightDetails = `🛫 <b>IDA:</b> ${flight.origin?.city} (${flight.origin?.code}) → ${flight.destination?.city} (${flight.destination?.code})
📅 <b>${this.formatDate(flight.departure?.date)}</b> a las <b>${this.formatTime(flight.departure?.time)}</b>
⏱️ <b>Duración:</b> ${outboundDuration}
✈️ <b>${flight.airline?.name || 'N/A'}</b>
${stopsInfo}

🛬 <b>VUELTA:</b> ${flight.destination?.city} (${flight.destination?.code}) → ${flight.origin?.city} (${flight.origin?.code})
📅 <b>${this.formatDate(flight.returnFlight.departure?.date)}</b> a las <b>${this.formatTime(flight.returnFlight.departure?.time)}</b>
⏱️ <b>Duración:</b> ${returnDuration}
✈️ <b>${flight.returnFlight.airline?.name || 'N/A'}</b>
${flight.returnFlight.isDirect ? '🚀 <b>DIRECTO</b>' : `🔄 <b>${flight.returnFlight.numberOfStops || 0} escalas</b>`}`;
		} else {
			const duration = this.formatDuration(
				flight.duration?.minutes || flight.duration?.total
			);

			flightDetails = `🛫 <b>${flight.origin?.city} (${flight.origin?.code})</b>
🛬 <b>${flight.destination?.city} (${flight.destination?.code})</b>

📅 <b>${this.formatDate(flight.departure?.date)}</b> a las <b>${this.formatTime(flight.departure?.time)}</b>
⏱️ <b>Duración:</b> ${duration}
✈️ <b>Aerolínea:</b> ${flight.airline?.name || 'N/A'}
${stopsInfo}`;
		}

		return `${emoji} <b>¡PRECIO DETECTADO!</b>

${flightDetails}

💰 <b>PRECIO TOTAL: €${flight.price?.amount}</b>${priceChange}

${isNewLow ? '🏆 <b>¡NUEVO PRECIO MÍNIMO!</b>' : ''}
🎯 <b>Umbral:</b> €${routeMonitor.priceThreshold}
📈 <b>Precio promedio:</b> ${avgPrice}
⭐ <b>Calidad del vuelo:</b> ${flight.flightQuality || 'N/A'}/100

<i>Ruta: ${routeMonitor.name}</i>`;
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

	formatDuration(durationInput) {
		if (!durationInput) return 'N/A';

		try {
			let minutes;

			// Si viene como string "XhYm", parsearlo
			if (typeof durationInput === 'string') {
				const match = durationInput.match(/(\d+)h\s*(\d+)m/);
				if (match) {
					const hours = parseInt(match[1]);
					const mins = parseInt(match[2]);
					minutes = hours * 60 + mins;
				} else {
					return durationInput; // Devolver tal como está si no se puede parsear
				}
			}
			// Si viene como número (minutos)
			else if (typeof durationInput === 'number') {
				minutes = durationInput;
			} else {
				return 'N/A';
			}

			// Validar que sea un número razonable (menos de 24 horas)
			if (isNaN(minutes) || minutes <= 0 || minutes > 1440) {
				return 'N/A';
			}

			const hours = Math.floor(minutes / 60);
			const mins = minutes % 60;
			return `${hours}h ${mins}m`;
		} catch (error) {
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
