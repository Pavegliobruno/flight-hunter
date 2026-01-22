// src/services/telegramCommands.service.js
const RouteMonitor = require('../models/routeMonitor.models');
const User = require('../models/user.model');

class TelegramCommandsService {
	constructor(telegramService) {
		this.telegramService = telegramService;
		this.commands = {
			'/start': this.handleStart.bind(this),
			'/help': this.handleHelp.bind(this),
			'/monitors': this.handleListMonitors.bind(this),
			'/create': this.handleCreate.bind(this),
			'/cancel': this.handleCancel.bind(this),
			'/users': this.handleUsers.bind(this),
		};

		this.adminChatId = process.env.TELEGRAM_CHAT_ID;
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
		const chatId = msg.chat.id.toString();
		const commandWithoutSlash = match[1];
		const command = `/${commandWithoutSlash}`;
		const args = msg.text.split(' ').slice(1);

		try {
			// Verificar/crear usuario
			const user = await this.getOrCreateUser(msg);

			// Si el usuario está pendiente o bloqueado, mostrar mensaje apropiado
			if (user.status === 'pending') {
				await this.sendMessage(chatId, 'Tu solicitud está pendiente de aprobación.');
				return;
			}

			if (user.status === 'blocked') {
				await this.sendMessage(chatId, 'No tenés acceso a este bot.');
				return;
			}

			// Comando /users solo para admin
			if (command === '/users' && !user.isAdmin) {
				await this.sendMessage(chatId, 'No tenés permisos para este comando.');
				return;
			}

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
					'Comando no reconocido. Usa /help para ver comandos disponibles.'
				);
			}
		} catch (error) {
			console.error(`Error procesando comando ${command}:`, error);
			await this.sendMessage(
				chatId,
				'Error procesando el comando. Intenta nuevamente.'
			);
		}
	}

	async getOrCreateUser(msg) {
		const chatId = msg.chat.id.toString();
		let user = await User.findOne({ chatId });

		if (!user) {
			// Usuario nuevo
			const isAdmin = chatId === this.adminChatId;

			user = new User({
				chatId,
				username: msg.from?.username || null,
				firstName: msg.from?.first_name || null,
				lastName: msg.from?.last_name || null,
				status: isAdmin ? 'active' : 'pending',
				isAdmin,
			});

			await user.save();

			// Si no es admin, notificar al admin
			if (!isAdmin) {
				await this.notifyAdminNewUser(user);
			}

			console.log(`Nuevo usuario: ${user.firstName || user.username || chatId} (${user.status})`);
		} else {
			// Actualizar última actividad
			user.lastActivity = new Date();
			await user.save();
		}

		return user;
	}

	async notifyAdminNewUser(user) {
		if (!this.adminChatId) return;

		const displayName = user.firstName
			? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
			: user.username || user.chatId;

		const message = `<b>Nuevo usuario</b>

Nombre: ${displayName}
Username: ${user.username ? '@' + user.username : '-'}
ID: <code>${user.chatId}</code>`;

		await this.telegramService.bot.sendMessage(this.adminChatId, message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[
						{ text: 'Aprobar', callback_data: `approve_${user.chatId}` },
						{ text: 'Rechazar', callback_data: `reject_${user.chatId}` },
					],
				],
			},
		});
	}

	async handleMessage(msg) {
		const chatId = msg.chat.id.toString();
		const text = msg.text?.trim();

		// Verificar usuario
		const user = await User.findOne({ chatId });
		if (!user || user.status !== 'active') {
			return false;
		}

		// Si no hay conversación activa, ignorar
		if (!this.conversationState.has(chatId)) {
			return false;
		}

		try {
			await this.processConversationStep(chatId, text);
			return true;
		} catch (error) {
			console.error('Error procesando mensaje:', error);
			await this.sendMessage(chatId, 'Error procesando tu respuesta. Intenta nuevamente.');
			return true;
		}
	}

	async handleStart(chatId) {
		const message = `<b>Monitor de Vuelos</b>

Recibirás alertas cuando encuentre precios bajos en las rutas que configuraste.

<b>Comandos:</b>
/create - Crear un nuevo monitor
/monitors - Ver y gestionar monitores
/help - Ayuda`;

		await this.sendMessage(chatId, message);
	}

	async handleHelp(chatId) {
		const user = await User.findOne({ chatId: chatId.toString() });
		const isAdmin = user?.isAdmin;

		let message = `<b>Comandos</b>

<b>/create</b> - Crear nuevo monitor
<b>/monitors</b> - Ver y gestionar monitores
<b>/cancel</b> - Cancelar operación en curso`;

		if (isAdmin) {
			message += `\n\n<b>Admin:</b>\n<b>/users</b> - Gestionar usuarios`;
		}

		await this.sendMessage(chatId, message);
	}

	async handleUsers(chatId) {
		const users = await User.find({ isAdmin: false }).sort({ createdAt: -1 });

		if (users.length === 0) {
			await this.sendMessage(chatId, 'No hay usuarios registrados.');
			return;
		}

		for (const user of users) {
			await this.sendUserCard(chatId, user);
		}

		const activeCount = users.filter(u => u.status === 'active').length;
		const pendingCount = users.filter(u => u.status === 'pending').length;
		const blockedCount = users.filter(u => u.status === 'blocked').length;

		await this.sendMessage(chatId, `${users.length} usuarios (${activeCount} activos, ${pendingCount} pendientes, ${blockedCount} bloqueados)`);
	}

	async sendUserCard(chatId, user) {
		const displayName = user.firstName
			? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
			: user.username || user.chatId;

		const statusText = {
			active: 'Activo',
			pending: 'Pendiente',
			blocked: 'Bloqueado',
		}[user.status];

		const monitorsCount = await RouteMonitor.countDocuments({ 'notifications.telegram.chatId': user.chatId });

		const message = `<b>${displayName}</b>
${user.username ? '@' + user.username : '-'}
${statusText} | ${monitorsCount} monitores`;

		const buttons = [];

		if (user.status === 'active') {
			buttons.push([
				{ text: 'Monitores', callback_data: `usermonitors_${user.chatId}` },
				{ text: 'Bloquear', callback_data: `blockuser_${user.chatId}` },
			]);
		} else if (user.status === 'blocked') {
			buttons.push([
				{ text: 'Desbloquear', callback_data: `unblockuser_${user.chatId}` },
			]);
		} else if (user.status === 'pending') {
			buttons.push([
				{ text: 'Aprobar', callback_data: `approve_${user.chatId}` },
				{ text: 'Rechazar', callback_data: `reject_${user.chatId}` },
			]);
		}

		await this.telegramService.bot.sendMessage(chatId, message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: buttons,
			},
		});
	}

	async updateUserCard(chatId, messageId, user) {
		const displayName = user.firstName
			? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
			: user.username || user.chatId;

		const statusText = {
			active: 'Activo',
			pending: 'Pendiente',
			blocked: 'Bloqueado',
		}[user.status];

		const monitorsCount = await RouteMonitor.countDocuments({ 'notifications.telegram.chatId': user.chatId });

		const message = `<b>${displayName}</b>
${user.username ? '@' + user.username : '-'}
${statusText} | ${monitorsCount} monitores`;

		const buttons = [];

		if (user.status === 'active') {
			buttons.push([
				{ text: 'Bloquear', callback_data: `blockuser_${user.chatId}` },
			]);
		} else if (user.status === 'blocked') {
			buttons.push([
				{ text: 'Desbloquear', callback_data: `unblockuser_${user.chatId}` },
			]);
		}

		await this.telegramService.bot.editMessageText(message, {
			chat_id: chatId,
			message_id: messageId,
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: buttons,
			},
		});
	}

	async handleListMonitors(chatId) {
		try {
			// Siempre mostrar solo los monitores del usuario actual
			const monitors = await RouteMonitor.find({
				'notifications.telegram.chatId': chatId.toString()
			}).sort({createdAt: -1});

			if (monitors.length === 0) {
				await this.sendMessage(chatId, 'No hay monitores configurados.\n\nUsa /create para crear uno.');
				return;
			}

			// Enviar cada monitor con sus botones
			for (const monitor of monitors) {
				await this.sendMonitorCard(chatId, monitor);
			}

			// Resumen final
			const activeCount = monitors.filter((m) => m.isActive).length;
			const pausedCount = monitors.length - activeCount;

			await this.sendMessage(chatId, `${monitors.length} monitores (${activeCount} activos, ${pausedCount} pausados)`);
		} catch (error) {
			console.error('Error obteniendo monitores:', error);
			await this.sendMessage(chatId, 'Error obteniendo la lista de monitores.');
		}
	}

	async sendMonitorCard(chatId, monitor) {
		const status = monitor.isActive ? 'Activo' : 'Pausado';
		const bestPrice = monitor.bestPrice?.amount
			? `€${Math.round(monitor.bestPrice.amount)}`
			: '-';

		const outbound = monitor.outboundDateRange;
		const inbound = monitor.inboundDateRange;
		const idaStr = outbound ? `${this.formatShortDate(outbound.startDate)} - ${this.formatShortDate(outbound.endDate)}` : '-';
		const vueltaStr = inbound ? `${this.formatShortDate(inbound.startDate)} - ${this.formatShortDate(inbound.endDate)}` : '';

		let message = `<b>${monitor.name}</b>
${monitor.origin} → ${monitor.destination}
Ida: ${idaStr}`;

		if (monitor.flightType === 'roundtrip' && vueltaStr) {
			message += `\nVuelta: ${vueltaStr}`;
		}

		message += `\nUmbral: €${monitor.priceThreshold} | Mejor: ${bestPrice} | ${status}`;

		// Botones según estado
		const buttons = [];

		if (monitor.isActive) {
			buttons.push([
				{ text: 'Pausar', callback_data: `pause_${monitor._id}` },
				{ text: 'Buscar', callback_data: `check_${monitor._id}` },
				{ text: 'Eliminar', callback_data: `delete_${monitor._id}` },
			]);
		} else {
			buttons.push([
				{ text: 'Reanudar', callback_data: `resume_${monitor._id}` },
				{ text: 'Buscar', callback_data: `check_${monitor._id}` },
				{ text: 'Eliminar', callback_data: `delete_${monitor._id}` },
			]);
		}

		await this.telegramService.bot.sendMessage(chatId, message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: buttons,
			},
		});
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
	// CALLBACK QUERIES
	// ==================

	async handleCallbackQuery(callbackQuery) {
		const chatId = callbackQuery.message.chat.id;
		const messageId = callbackQuery.message.message_id;
		const data = callbackQuery.data;

		try {
			const [action, id] = data.split('_');

			switch (action) {
				case 'pause':
					await this.handlePauseCallback(chatId, messageId, id, callbackQuery.id);
					break;
				case 'resume':
					await this.handleResumeCallback(chatId, messageId, id, callbackQuery.id);
					break;
				case 'delete':
					await this.handleDeleteCallback(chatId, messageId, id, callbackQuery.id);
					break;
				case 'confirmdelete':
					await this.handleConfirmDeleteCallback(chatId, messageId, id, callbackQuery.id);
					break;
				case 'canceldelete':
					await this.handleCancelDeleteCallback(chatId, messageId, id, callbackQuery.id);
					break;
				case 'check':
					await this.handleCheckCallback(chatId, messageId, id, callbackQuery.id);
					break;
				case 'approve':
					await this.handleApproveUserCallback(chatId, messageId, id, callbackQuery.id);
					break;
				case 'reject':
					await this.handleRejectUserCallback(chatId, messageId, id, callbackQuery.id);
					break;
				case 'blockuser':
					await this.handleBlockUserCallback(chatId, messageId, id, callbackQuery.id);
					break;
				case 'unblockuser':
					await this.handleUnblockUserCallback(chatId, messageId, id, callbackQuery.id);
					break;
				case 'usermonitors':
					await this.handleUserMonitorsCallback(chatId, id, callbackQuery.id);
					break;
				default:
					await this.telegramService.bot.answerCallbackQuery(callbackQuery.id, {
						text: 'Acción no reconocida',
					});
			}
		} catch (error) {
			console.error('Error en callback query:', error);
			await this.telegramService.bot.answerCallbackQuery(callbackQuery.id, {
				text: 'Error procesando acción',
			});
		}
	}

	async handleApproveUserCallback(chatId, messageId, userChatId, callbackId) {
		const user = await User.findOne({ chatId: userChatId });
		if (!user) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Usuario no encontrado',
			});
			return;
		}

		user.status = 'active';
		await user.save();

		const displayName = user.firstName || user.username || user.chatId;

		// Actualizar mensaje del admin
		await this.telegramService.bot.editMessageText(
			`<b>${displayName}</b>\nAprobado`,
			{
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
			}
		);

		// Notificar al usuario
		await this.telegramService.bot.sendMessage(
			userChatId,
			'Tu cuenta fue aprobada. Ya podés usar el bot.\n\nUsa /help para ver los comandos disponibles.'
		);

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Usuario aprobado',
		});

		console.log(`Usuario aprobado: ${displayName}`);
	}

	async handleRejectUserCallback(chatId, messageId, userChatId, callbackId) {
		const user = await User.findOne({ chatId: userChatId });
		if (!user) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Usuario no encontrado',
			});
			return;
		}

		user.status = 'blocked';
		await user.save();

		const displayName = user.firstName || user.username || user.chatId;

		// Actualizar mensaje del admin
		await this.telegramService.bot.editMessageText(
			`<s>${displayName}</s>\nRechazado`,
			{
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
			}
		);

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Usuario rechazado',
		});

		console.log(`Usuario rechazado: ${displayName}`);
	}

	async handleBlockUserCallback(chatId, messageId, userChatId, callbackId) {
		const user = await User.findOne({ chatId: userChatId });
		if (!user) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Usuario no encontrado',
			});
			return;
		}

		user.status = 'blocked';
		await user.save();

		await this.updateUserCard(chatId, messageId, user);

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Usuario bloqueado',
		});
	}

	async handleUnblockUserCallback(chatId, messageId, userChatId, callbackId) {
		const user = await User.findOne({ chatId: userChatId });
		if (!user) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Usuario no encontrado',
			});
			return;
		}

		user.status = 'active';
		await user.save();

		await this.updateUserCard(chatId, messageId, user);

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Usuario desbloqueado',
		});
	}

	async handleUserMonitorsCallback(chatId, userChatId, callbackId) {
		const user = await User.findOne({ chatId: userChatId });
		if (!user) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Usuario no encontrado',
			});
			return;
		}

		await this.telegramService.bot.answerCallbackQuery(callbackId);

		const displayName = user.firstName || user.username || user.chatId;
		const monitors = await RouteMonitor.find({
			'notifications.telegram.chatId': userChatId
		}).sort({ createdAt: -1 });

		if (monitors.length === 0) {
			await this.sendMessage(chatId, `<b>${displayName}</b> no tiene monitores.`);
			return;
		}

		await this.sendMessage(chatId, `Monitores de <b>${displayName}</b>:`);

		for (const monitor of monitors) {
			await this.sendMonitorCard(chatId, monitor);
		}
	}

	async handlePauseCallback(chatId, messageId, monitorId, callbackId) {
		const monitor = await RouteMonitor.findById(monitorId);
		if (!monitor) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: '❌ Monitor no encontrado',
			});
			return;
		}

		monitor.isActive = false;
		await monitor.save();

		// Actualizar mensaje con nuevos botones
		await this.updateMonitorCard(chatId, messageId, monitor);

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Monitor pausado',
		});

		console.log(`Monitor pausado: ${monitor.name}`);
	}

	async handleResumeCallback(chatId, messageId, monitorId, callbackId) {
		const monitor = await RouteMonitor.findById(monitorId);
		if (!monitor) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: '❌ Monitor no encontrado',
			});
			return;
		}

		monitor.isActive = true;
		await monitor.save();

		// Actualizar mensaje con nuevos botones
		await this.updateMonitorCard(chatId, messageId, monitor);

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Monitor reactivado',
		});

		console.log(`Monitor reactivado: ${monitor.name}`);
	}

	async handleDeleteCallback(chatId, messageId, monitorId, callbackId) {
		const monitor = await RouteMonitor.findById(monitorId);
		if (!monitor) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: '❌ Monitor no encontrado',
			});
			return;
		}

		// Mostrar confirmación
		const message = `<b>¿Eliminar este monitor?</b>

${monitor.name}
${monitor.origin} → ${monitor.destination}`;

		await this.telegramService.bot.editMessageText(message, {
			chat_id: chatId,
			message_id: messageId,
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[
						{ text: 'Sí, eliminar', callback_data: `confirmdelete_${monitorId}` },
						{ text: 'Cancelar', callback_data: `canceldelete_${monitorId}` },
					],
				],
			},
		});

		await this.telegramService.bot.answerCallbackQuery(callbackId);
	}

	async handleConfirmDeleteCallback(chatId, messageId, monitorId, callbackId) {
		const monitor = await RouteMonitor.findByIdAndDelete(monitorId);

		if (!monitor) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: '❌ Monitor no encontrado',
			});
			return;
		}

		await this.telegramService.bot.editMessageText(
			`<s>${monitor.name}</s>\nEliminado`,
			{
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
			}
		);

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Monitor eliminado',
		});

		console.log(`Monitor eliminado: ${monitor.name}`);
	}

	async handleCancelDeleteCallback(chatId, messageId, monitorId, callbackId) {
		const monitor = await RouteMonitor.findById(monitorId);
		if (!monitor) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: '❌ Monitor no encontrado',
			});
			return;
		}

		// Restaurar card original
		await this.updateMonitorCard(chatId, messageId, monitor);

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Cancelado',
		});
	}

	async handleCheckCallback(chatId, messageId, monitorId, callbackId) {
		const monitor = await RouteMonitor.findById(monitorId);
		if (!monitor) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: '❌ Monitor no encontrado',
			});
			return;
		}

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Buscando vuelos...',
		});

		// Importar y ejecutar búsqueda
		const MonitoringService = require('./monitoring.service');
		const monitoringService = new MonitoringService();

		try {
			await monitoringService.checkRoute(monitor);
			await this.telegramService.bot.sendMessage(chatId,
				`Búsqueda completada: <b>${monitor.name}</b>`,
				{ parse_mode: 'HTML' }
			);
		} catch (error) {
			console.error('Error en búsqueda manual:', error);
			await this.telegramService.bot.sendMessage(chatId,
				`Error buscando vuelos para ${monitor.name}`,
				{ parse_mode: 'HTML' }
			);
		}

		console.log(`Búsqueda manual iniciada: ${monitor.name}`);
	}

	async updateMonitorCard(chatId, messageId, monitor) {
		const status = monitor.isActive ? 'Activo' : 'Pausado';
		const bestPrice = monitor.bestPrice?.amount
			? `€${Math.round(monitor.bestPrice.amount)}`
			: '-';

		const outbound = monitor.outboundDateRange;
		const inbound = monitor.inboundDateRange;
		const idaStr = outbound ? `${this.formatShortDate(outbound.startDate)} - ${this.formatShortDate(outbound.endDate)}` : '-';
		const vueltaStr = inbound ? `${this.formatShortDate(inbound.startDate)} - ${this.formatShortDate(inbound.endDate)}` : '';

		let message = `<b>${monitor.name}</b>
${monitor.origin} → ${monitor.destination}
Ida: ${idaStr}`;

		if (monitor.flightType === 'roundtrip' && vueltaStr) {
			message += `\nVuelta: ${vueltaStr}`;
		}

		message += `\nUmbral: €${monitor.priceThreshold} | Mejor: ${bestPrice} | ${status}`;

		const buttons = [];

		if (monitor.isActive) {
			buttons.push([
				{ text: 'Pausar', callback_data: `pause_${monitor._id}` },
				{ text: 'Buscar', callback_data: `check_${monitor._id}` },
				{ text: 'Eliminar', callback_data: `delete_${monitor._id}` },
			]);
		} else {
			buttons.push([
				{ text: 'Reanudar', callback_data: `resume_${monitor._id}` },
				{ text: 'Buscar', callback_data: `check_${monitor._id}` },
				{ text: 'Eliminar', callback_data: `delete_${monitor._id}` },
			]);
		}

		await this.telegramService.bot.editMessageText(message, {
			chat_id: chatId,
			message_id: messageId,
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: buttons,
			},
		});
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

	formatShortDate(dateStr) {
		if (!dateStr) return '-';
		const date = new Date(dateStr);
		return date.toLocaleDateString('es-ES', {
			day: '2-digit',
			month: 'short',
		});
	}
}

module.exports = TelegramCommandsService;
