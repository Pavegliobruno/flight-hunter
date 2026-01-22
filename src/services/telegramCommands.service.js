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
			'/create': this.handleCreate.bind(this),
			'/cancel': this.handleCancel.bind(this),
		};
		// Estado de conversación para cada chat
		this.conversationState = new Map();

		// Aeropuertos disponibles organizados por región
		this.availableAirports = {
			'🇦🇷 Argentina': {
				BUE: 'Buenos Aires (todos)',
				EZE: 'Ezeiza',
				AEP: 'Aeroparque',
				COR: 'Córdoba',
				ROS: 'Rosario',
				MDZ: 'Mendoza',
				IGU: 'Iguazú',
				USH: 'Ushuaia',
				BRC: 'Bariloche',
				FTE: 'El Calafate',
			},
			'🇪🇸 España': {
				MAD: 'Madrid',
				BCN: 'Barcelona',
				VLC: 'Valencia',
				SVQ: 'Sevilla',
				BIO: 'Bilbao',
				PMI: 'Palma de Mallorca',
				LPA: 'Las Palmas',
				TFS: 'Tenerife Sur',
			},
			'🇪🇺 Europa': {
				BER: 'Berlín',
				VIE: 'Viena',
				CDG: 'París CDG',
				LHR: 'Londres Heathrow',
				FCO: 'Roma Fiumicino',
				AMS: 'Ámsterdam',
				FRA: 'Frankfurt',
				MUC: 'Múnich',
				ZUR: 'Zúrich',
				LIS: 'Lisboa',
				MXP: 'Milán Malpensa',
				BRI: 'Bari',
				IST: 'Estambul',
			},
			'🌎 Américas': {
				MIA: 'Miami',
				JFK: 'Nueva York JFK',
				LAX: 'Los Ángeles',
				MEX: 'Ciudad de México',
				GRU: 'São Paulo',
				GIG: 'Río de Janeiro',
				SCL: 'Santiago de Chile',
				LIM: 'Lima',
				BOG: 'Bogotá',
				CUN: 'Cancún',
			},
			'🌏 Asia': {
				NRT: 'Tokio Narita',
				HND: 'Tokio Haneda',
				KIX: 'Osaka Kansai',
				ICN: 'Seúl Incheon',
				PVG: 'Shanghái',
				PEK: 'Pekín',
				HKG: 'Hong Kong',
				SIN: 'Singapur',
				BKK: 'Bangkok',
			},
			'🌏 Oceanía': {
				SYD: 'Sídney',
				MEL: 'Melbourne',
				AKL: 'Auckland',
			},
		};

		// Lista plana de códigos válidos
		this.validAirportCodes = new Set();
		for (const region of Object.values(this.availableAirports)) {
			for (const code of Object.keys(region)) {
				this.validAirportCodes.add(code);
			}
		}
	}

	async handleCommand(msg, match) {
		const chatId = msg.chat.id;
		const commandWithoutSlash = match[1];
		const command = `/${commandWithoutSlash}`;
		const args = msg.text.split(' ').slice(1);

		try {
			// Si hay conversación activa y el usuario envía /cancel, cancelar
			if (command === '/cancel') {
				await this.handleCancel(chatId);
				return;
			}

			// Si hay un comando válido, ejecutarlo (cancela cualquier conversación activa)
			if (this.commands[command]) {
				if (command !== '/create' && this.conversationState.has(chatId)) {
					this.conversationState.delete(chatId);
				}
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

	async handleMessage(msg) {
		const chatId = msg.chat.id;
		const text = msg.text?.trim();

		// Si no hay conversación activa, ignorar
		if (!this.conversationState.has(chatId)) {
			return false;
		}

		try {
			await this.processConversationStep(chatId, text);
			return true;
		} catch (error) {
			console.error('❌ Error procesando mensaje:', error);
			await this.sendMessage(chatId, '❌ Error procesando tu respuesta. Intenta nuevamente.');
			return true;
		}
	}

	async handleStart(chatId) {
		const message = `🛫 <b>¡Bienvenido al Monitor de Vuelos!</b>

Recibirás alertas automáticas cuando encuentre precios bajos en las rutas que configuraste.

<b>Comandos disponibles:</b>
/create - ✨ Crear un nuevo monitor
/monitors - Ver todas las rutas monitoreadas
/status - Estado del sistema de monitoreo
/pause [ID] - Pausar un monitor específico
/resume [ID] - Reactivar un monitor pausado
/help - Mostrar ayuda detallada

<i>El sistema está monitoreando automáticamente cada 30 minutos.</i>`;

		await this.sendMessage(chatId, message);
	}

	async handleHelp(chatId) {
		const message = `📋 <b>Comandos del Monitor de Vuelos</b>

<b>/create</b> - ✨ Crear nuevo monitor
   Inicia un asistente paso a paso

<b>/monitors</b> - Ver todas las rutas monitoreadas
   Muestra ID, ruta, estado y mejor precio

<b>/status</b> - Estado del sistema
   Estadísticas de monitoreo y última verificación

<b>/pause [ID]</b> - Pausar monitor
   Ejemplo: /pause 507f1f77bcf86cd799439011

<b>/resume [ID]</b> - Reactivar monitor
   Ejemplo: /resume 507f1f77bcf86cd799439011

<b>/cancel</b> - Cancelar operación en curso

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

	// ==================
	// COMANDO /create
	// ==================

	async handleCreate(chatId) {
		// Iniciar conversación
		this.conversationState.set(chatId, {
			step: 'origin',
			data: {},
		});

		const airportList = this.formatAirportList();

		const message = `✈️ <b>Crear Nuevo Monitor</b>

Vamos a configurar un nuevo monitor de vuelos paso a paso.

<b>Paso 1/6:</b> ¿Cuál es el <b>origen</b>?
Enviá el código de 3 letras (ej: BER, EZE, MAD)

${airportList}

<i>Escribe /cancel para cancelar.</i>`;

		await this.sendMessage(chatId, message);
	}

	formatAirportList() {
		let list = '<b>Aeropuertos disponibles:</b>\n';
		for (const [region, airports] of Object.entries(this.availableAirports)) {
			list += `\n${region}\n`;
			const codes = Object.entries(airports)
				.map(([code, name]) => `<code>${code}</code> ${name}`)
				.join(' • ');
			list += codes + '\n';
		}
		return list;
	}

	async handleCancel(chatId) {
		if (this.conversationState.has(chatId)) {
			this.conversationState.delete(chatId);
			await this.sendMessage(chatId, '❌ Creación de monitor cancelada.');
		} else {
			await this.sendMessage(chatId, 'No hay ninguna operación en curso.');
		}
	}

	async processConversationStep(chatId, text) {
		const state = this.conversationState.get(chatId);
		if (!state) return;

		switch (state.step) {
			case 'origin':
				await this.handleOriginStep(chatId, text, state);
				break;
			case 'destination':
				await this.handleDestinationStep(chatId, text, state);
				break;
			case 'outbound_dates':
				await this.handleOutboundDatesStep(chatId, text, state);
				break;
			case 'inbound_dates':
				await this.handleInboundDatesStep(chatId, text, state);
				break;
			case 'price':
				await this.handlePriceStep(chatId, text, state);
				break;
			case 'max_stops':
				await this.handleMaxStopsStep(chatId, text, state);
				break;
			case 'confirm':
				await this.handleConfirmStep(chatId, text, state);
				break;
		}
	}

	async handleOriginStep(chatId, text, state) {
		const origin = text.toUpperCase().trim();

		if (!this.validAirportCodes.has(origin)) {
			await this.sendMessage(chatId, `❌ Código <b>${origin}</b> no disponible.

Elegí uno de la lista o escribí /cancel para cancelar.`);
			return;
		}

		const originName = this.getAirportName(origin);
		state.data.origin = origin;
		state.step = 'destination';
		this.conversationState.set(chatId, state);

		const airportList = this.formatAirportList();

		await this.sendMessage(chatId, `✅ Origen: <b>${origin}</b> (${originName})

<b>Paso 2/6:</b> ¿Cuál es el <b>destino</b>?

${airportList}`);
	}

	getAirportName(code) {
		for (const airports of Object.values(this.availableAirports)) {
			if (airports[code]) return airports[code];
		}
		return code;
	}

	async handleDestinationStep(chatId, text, state) {
		const destination = text.toUpperCase().trim();

		if (!this.validAirportCodes.has(destination)) {
			await this.sendMessage(chatId, `❌ Código <b>${destination}</b> no disponible.

Elegí uno de la lista o escribí /cancel para cancelar.`);
			return;
		}

		if (destination === state.data.origin) {
			await this.sendMessage(chatId, '❌ El destino no puede ser igual al origen.');
			return;
		}

		const destinationName = this.getAirportName(destination);
		state.data.destination = destination;
		state.step = 'outbound_dates';
		this.conversationState.set(chatId, state);

		await this.sendMessage(chatId, `✅ Destino: <b>${destination}</b> (${destinationName})

<b>Paso 3/6:</b> ¿Fechas de <b>ida</b>?
Enviá el rango de fechas en formato:
<code>YYYY-MM-DD YYYY-MM-DD</code>

Ejemplo: <code>2026-05-01 2026-05-15</code>
(o una sola fecha si es fija)`);
	}

	async handleOutboundDatesStep(chatId, text, state) {
		const dates = text.trim().split(/\s+/);
		const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

		if (!dateRegex.test(dates[0])) {
			await this.sendMessage(chatId, '❌ Formato inválido. Usa YYYY-MM-DD (ej: 2026-05-01)');
			return;
		}

		const startDate = dates[0];
		const endDate = dates[1] && dateRegex.test(dates[1]) ? dates[1] : dates[0];

		state.data.outboundDateRange = {
			startDate,
			endDate,
			flexible: startDate !== endDate,
		};
		state.step = 'inbound_dates';
		this.conversationState.set(chatId, state);

		await this.sendMessage(chatId, `✅ Ida: <b>${startDate}</b> a <b>${endDate}</b>

<b>Paso 4/6:</b> ¿Fechas de <b>vuelta</b>?
Enviá el rango de fechas en formato:
<code>YYYY-MM-DD YYYY-MM-DD</code>

Ejemplo: <code>2026-05-30 2026-06-10</code>
(escribe "solo ida" si no hay vuelta)`);
	}

	async handleInboundDatesStep(chatId, text, state) {
		const input = text.trim().toLowerCase();

		if (input === 'solo ida' || input === 'oneway' || input === 'ida') {
			state.data.flightType = 'oneway';
			state.data.inboundDateRange = null;
		} else {
			const dates = text.trim().split(/\s+/);
			const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

			if (!dateRegex.test(dates[0])) {
				await this.sendMessage(chatId, '❌ Formato inválido. Usa YYYY-MM-DD o escribe "solo ida"');
				return;
			}

			const startDate = dates[0];
			const endDate = dates[1] && dateRegex.test(dates[1]) ? dates[1] : dates[0];

			state.data.flightType = 'roundtrip';
			state.data.inboundDateRange = {
				startDate,
				endDate,
				flexible: startDate !== endDate,
			};
		}

		state.step = 'price';
		this.conversationState.set(chatId, state);

		const vueltaMsg = state.data.flightType === 'oneway'
			? '✅ Tipo: <b>Solo ida</b>'
			: `✅ Vuelta: <b>${state.data.inboundDateRange.startDate}</b> a <b>${state.data.inboundDateRange.endDate}</b>`;

		await this.sendMessage(chatId, `${vueltaMsg}

<b>Paso 5/6:</b> ¿Precio <b>umbral</b> en EUR?
Recibirás alertas cuando el precio sea menor a este valor.

Ejemplo: <code>800</code>`);
	}

	async handlePriceStep(chatId, text, state) {
		const price = parseInt(text.trim());

		if (isNaN(price) || price <= 0 || price > 10000) {
			await this.sendMessage(chatId, '❌ Precio inválido. Debe ser un número entre 1 y 10000.');
			return;
		}

		state.data.priceThreshold = price;
		state.step = 'max_stops';
		this.conversationState.set(chatId, state);

		await this.sendMessage(chatId, `✅ Umbral: <b>€${price}</b>

<b>Paso 6/6:</b> ¿Máximo de <b>escalas</b>?
Enviá un número (0 = solo directos, 1, 2, etc.)

Ejemplo: <code>2</code>
(escribe "cualquiera" para no limitar)`);
	}

	async handleMaxStopsStep(chatId, text, state) {
		const input = text.trim().toLowerCase();

		if (input === 'cualquiera' || input === 'any' || input === '-') {
			state.data.maxStops = null;
		} else {
			const maxStops = parseInt(input);
			if (isNaN(maxStops) || maxStops < 0 || maxStops > 5) {
				await this.sendMessage(chatId, '❌ Valor inválido. Debe ser 0-5 o "cualquiera".');
				return;
			}
			state.data.maxStops = maxStops;
		}

		state.step = 'confirm';
		this.conversationState.set(chatId, state);

		const stopsMsg = state.data.maxStops === null ? 'Sin límite' : state.data.maxStops;
		const flightTypeMsg = state.data.flightType === 'oneway' ? 'Solo ida' : 'Ida y vuelta';

		const summary = `📋 <b>Resumen del Monitor</b>

🛫 <b>Ruta:</b> ${state.data.origin} → ${state.data.destination}
📅 <b>Ida:</b> ${state.data.outboundDateRange.startDate} a ${state.data.outboundDateRange.endDate}
${state.data.flightType === 'roundtrip' ? `📅 <b>Vuelta:</b> ${state.data.inboundDateRange.startDate} a ${state.data.inboundDateRange.endDate}` : ''}
✈️ <b>Tipo:</b> ${flightTypeMsg}
💰 <b>Umbral:</b> €${state.data.priceThreshold}
🔄 <b>Escalas máx:</b> ${stopsMsg}

¿Confirmar creación? Escribe <b>si</b> o <b>no</b>`;

		await this.sendMessage(chatId, summary);
	}

	async handleConfirmStep(chatId, text, state) {
		const input = text.trim().toLowerCase();

		if (input === 'si' || input === 'sí' || input === 'yes' || input === 's') {
			try {
				const originName = this.getAirportName(state.data.origin);
				const destName = this.getAirportName(state.data.destination);

				const monitorData = {
					name: `${originName} → ${destName}`,
					origin: state.data.origin,
					destination: state.data.destination,
					priceThreshold: state.data.priceThreshold,
					flightType: state.data.flightType,
					outboundDateRange: state.data.outboundDateRange,
					inboundDateRange: state.data.inboundDateRange,
					maxStops: state.data.maxStops,
					passengers: 1,
					checkInterval: 30,
					notifications: {
						enabled: true,
						telegram: {
							chatId: chatId.toString(),
						},
					},
				};

				const monitor = new RouteMonitor(monitorData);
				await monitor.save();

				this.conversationState.delete(chatId);

				await this.sendMessage(chatId, `✅ <b>¡Monitor creado exitosamente!</b>

🆔 ID: <code>${monitor._id}</code>
🛫 ${monitor.origin} → ${monitor.destination}
💰 Umbral: €${monitor.priceThreshold}

El monitor comenzará a buscar vuelos en el próximo ciclo.
Usa /monitors para ver todos tus monitores.`);

				console.log(`✅ Monitor creado desde Telegram: ${monitor.name} (${monitor._id})`);
			} catch (error) {
				console.error('❌ Error creando monitor:', error);
				await this.sendMessage(chatId, '❌ Error creando el monitor. Intenta nuevamente con /create');
				this.conversationState.delete(chatId);
			}
		} else if (input === 'no' || input === 'n') {
			this.conversationState.delete(chatId);
			await this.sendMessage(chatId, '❌ Creación cancelada. Usa /create para empezar de nuevo.');
		} else {
			await this.sendMessage(chatId, '❌ Responde <b>si</b> o <b>no</b>');
		}
	}

	// ==================
	// Métodos auxiliares
	// ==================

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
