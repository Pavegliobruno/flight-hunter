// src/services/telegramCommands.service.js
const RouteMonitor = require('../models/routeMonitor.models');
const User = require('../models/user.model');
const KiwiService = require('./kiwi.service');

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

		// Servicio de Kiwi para búsqueda de ubicaciones
		this.kiwiService = new KiwiService();
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
				await this.sendMessage(
					chatId,
					`<b>Solicitud pendiente</b>

Tu solicitud de acceso está siendo revisada. Te notificaremos cuando sea aprobada.

<i>Consultas? Contacta a @pavegliobruno</i>`
				);
				return;
			}

			if (user.status === 'blocked') {
				await this.sendMessage(
					chatId,
					`<b>Acceso denegado</b>

No tenés acceso a este bot.

<i>Si crees que es un error, contacta a @pavegliobruno</i>`
				);
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
		let user = await User.findOne({chatId});

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

			console.log(
				`Nuevo usuario: ${user.firstName || user.username || chatId} (${user.status})`
			);
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
						{text: 'Aprobar', callback_data: `approve_${user.chatId}`},
						{text: 'Rechazar', callback_data: `reject_${user.chatId}`},
					],
				],
			},
		});
	}

	async handleMessage(msg) {
		const chatId = msg.chat.id.toString();
		const text = msg.text?.trim();

		// Si no hay conversación activa, ignorar
		if (!this.conversationState.has(chatId)) {
			return false;
		}

		// Verificar usuario solo si hay conversación activa
		const user = await User.findOne({chatId});
		if (!user || user.status !== 'active') {
			return false;
		}

		try {
			await this.processConversationStep(chatId, text);
			return true;
		} catch (error) {
			console.error('Error procesando mensaje:', error);
			await this.sendMessage(
				chatId,
				'Error procesando tu respuesta. Intenta nuevamente.'
			);
			return true;
		}
	}

	async handleStart(chatId) {
		const message = `<b>Monitor de Vuelos</b>

Recibirás alertas cuando encuentre precios bajos en las rutas que configuraste.

<b>Comandos:</b>
/create - Crear un nuevo monitor
/monitors - Ver y gestionar monitores
/help - Ayuda

<i>Dudas o sugerencias? Contacta a @pavegliobruno</i>`;

		await this.sendMessage(chatId, message);
	}

	async handleHelp(chatId) {
		const user = await User.findOne({chatId: chatId.toString()});
		const isAdmin = user?.isAdmin;

		let message = `<b>Comandos</b>

<b>/create</b> - Crear nuevo monitor
<b>/monitors</b> - Ver y gestionar monitores
<b>/cancel</b> - Cancelar operación en curso`;

		if (isAdmin) {
			message += `\n\n<b>Admin:</b>\n<b>/users</b> - Gestionar usuarios`;
		}

		message += `\n\n<i>Dudas o sugerencias? Contacta a @pavegliobruno</i>`;

		await this.sendMessage(chatId, message);
	}

	async handleUsers(chatId, args, msg, filter = 'all', page = 0) {
		const USERS_PER_PAGE = 10;

		// Filtro de estado
		const statusFilter = filter === 'all' ? {} : {status: filter};
		const query = {isAdmin: false, ...statusFilter};

		// Obtener usuarios con conteo de monitores
		const users = await User.find(query).lean();

		// Agregar conteo de monitores a cada usuario
		const usersWithMonitors = await Promise.all(
			users.map(async (user) => {
				const monitorCount = await RouteMonitor.countDocuments({
					'notifications.telegram.chatId': user.chatId,
				});
				return {...user, monitorCount};
			})
		);

		// Ordenar por cantidad de monitores (descendente)
		usersWithMonitors.sort((a, b) => b.monitorCount - a.monitorCount);

		if (usersWithMonitors.length === 0) {
			await this.sendMessage(chatId, 'No hay usuarios registrados.');
			return;
		}

		// Calcular paginación
		const totalPages = Math.ceil(usersWithMonitors.length / USERS_PER_PAGE);
		const currentPage = Math.min(page, totalPages - 1);
		const startIdx = currentPage * USERS_PER_PAGE;
		const pageUsers = usersWithMonitors.slice(
			startIdx,
			startIdx + USERS_PER_PAGE
		);

		// Conteos por estado (del total, no filtrado)
		const allUsers = await User.find({isAdmin: false});
		const activeCount = allUsers.filter((u) => u.status === 'active').length;
		const pendingCount = allUsers.filter((u) => u.status === 'pending').length;
		const blockedCount = allUsers.filter((u) => u.status === 'blocked').length;

		// Construir mensaje
		const filterLabel = {
			all: 'Todos',
			active: 'Activos',
			pending: 'Pendientes',
			blocked: 'Bloqueados',
		}[filter];

		let message = `<b>Usuarios</b> (${filterLabel}: ${usersWithMonitors.length})\n`;
		message += `━━━━━━━━━━━━━━━━\n`;

		pageUsers.forEach((user, idx) => {
			const globalIdx = startIdx + idx + 1;
			const displayName = user.firstName
				? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
				: user.username || `ID:${user.chatId}`;
			const username = user.username ? ` @${user.username}` : '';
			const statusIcon = {
				active: '●',
				pending: '○',
				blocked: '✕',
			}[user.status];

			message += `${globalIdx}. ${statusIcon} ${displayName}${username} · ${user.monitorCount} mon.\n`;
		});

		message += `\n<i>Total: ${allUsers.length} (${activeCount} activos, ${pendingCount} pend., ${blockedCount} bloq.)</i>`;

		// Botones de filtro
		const filterButtons = [
			{
				text: filter === 'all' ? '• Todos' : 'Todos',
				callback_data: 'usersfilter_all_0',
			},
			{
				text: filter === 'active' ? '• Activos' : 'Activos',
				callback_data: 'usersfilter_active_0',
			},
			{
				text: filter === 'pending' ? '• Pend.' : 'Pend.',
				callback_data: 'usersfilter_pending_0',
			},
			{
				text: filter === 'blocked' ? '• Bloq.' : 'Bloq.',
				callback_data: 'usersfilter_blocked_0',
			},
		];

		// Botones de paginación
		const navButtons = [];
		if (currentPage > 0) {
			navButtons.push({
				text: '← Anterior',
				callback_data: `userspage_${filter}_${currentPage - 1}`,
			});
		}
		navButtons.push({
			text: `${currentPage + 1}/${totalPages}`,
			callback_data: 'noop',
		});
		if (currentPage < totalPages - 1) {
			navButtons.push({
				text: 'Siguiente →',
				callback_data: `userspage_${filter}_${currentPage + 1}`,
			});
		}

		// Botones para seleccionar usuario (números)
		const userSelectButtons = [];
		for (let i = 0; i < pageUsers.length; i += 5) {
			const row = pageUsers.slice(i, i + 5).map((user, idx) => ({
				text: `${startIdx + i + idx + 1}`,
				callback_data: `userselect_${user.chatId}_${filter}_${currentPage}`,
			}));
			userSelectButtons.push(row);
		}

		const keyboard = [filterButtons, ...userSelectButtons, navButtons];

		await this.telegramService.bot.sendMessage(chatId, message, {
			parse_mode: 'HTML',
			reply_markup: {inline_keyboard: keyboard},
		});
	}

	async handleListMonitors(chatId) {
		try {
			// Siempre mostrar solo los monitores del usuario actual
			const monitors = await RouteMonitor.find({
				'notifications.telegram.chatId': chatId.toString(),
			}).sort({createdAt: -1});

			if (monitors.length === 0) {
				await this.sendMessage(
					chatId,
					'No hay monitores configurados.\n\nUsa /create para crear uno.'
				);
				return;
			}

			// Enviar cada monitor con sus botones
			for (const monitor of monitors) {
				await this.sendMonitorCard(chatId, monitor);
			}

			// Resumen final
			const activeCount = monitors.filter((m) => m.isActive).length;
			const pausedCount = monitors.length - activeCount;

			await this.sendMessage(
				chatId,
				`${monitors.length} monitores (${activeCount} activos, ${pausedCount} pausados)`
			);
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
		const alertsSent = monitor.stats?.alertsSent || 0;

		const outbound = monitor.outboundDateRange;
		const inbound = monitor.inboundDateRange;
		const idaStr = outbound
			? `${this.formatShortDate(outbound.startDate)} - ${this.formatShortDate(outbound.endDate)}`
			: '-';
		const vueltaStr = inbound
			? `${this.formatShortDate(inbound.startDate)} - ${this.formatShortDate(inbound.endDate)}`
			: '';

		let message = `<b>${monitor.name}</b>
${monitor.origin} → ${monitor.destination}
Ida: ${idaStr}`;

		if (monitor.flightType === 'roundtrip' && vueltaStr) {
			message += `\nVuelta: ${vueltaStr}`;
		}

		message += `\nUmbral: €${monitor.priceThreshold} | Mejor: ${bestPrice} | ${status}`;
		message += `\n📬 Ofertas enviadas: ${alertsSent}`;

		// Botones según estado
		const buttons = [];

		if (monitor.isActive) {
			buttons.push([
				{text: 'Pausar', callback_data: `pause_${monitor._id}`},
				{text: 'Buscar', callback_data: `check_${monitor._id}`},
			]);
		} else {
			buttons.push([
				{text: 'Reanudar', callback_data: `resume_${monitor._id}`},
				{text: 'Buscar', callback_data: `check_${monitor._id}`},
			]);
		}

		buttons.push([
			{text: 'Editar', callback_data: `edit_${monitor._id}`},
			{text: 'Eliminar', callback_data: `delete_${monitor._id}`},
		]);

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

		const message = `✈️ <b>Crear Nuevo Monitor</b>

Vamos a configurar un nuevo monitor de vuelos paso a paso.

<b>Paso 1/6:</b> ¿Cuál es el <b>origen</b>?
Escribí el nombre de la ciudad o código IATA (ej: Berlin, Madrid, EZE)

<i>Escribe /cancel para cancelar.</i>`;

		await this.sendMessage(chatId, message);
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
			case 'origin_select':
				// Si está en origin_select y escribe texto, buscar de nuevo
				state.step = 'origin';
				await this.handleOriginStep(chatId, text, state);
				break;
			case 'destination':
			case 'destination_select':
				// Si está en destination_select y escribe texto, buscar de nuevo
				state.step = 'destination';
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
			case 'edit_price':
				await this.handleEditPriceStep(chatId, text, state);
				break;
			case 'edit_stops':
				await this.handleEditStopsStep(chatId, text, state);
				break;
			case 'edit_outbound':
				await this.handleEditOutboundStep(chatId, text, state);
				break;
			case 'edit_inbound':
				await this.handleEditInboundStep(chatId, text, state);
				break;
		}
	}

	async handleOriginStep(chatId, text, state) {
		const searchTerm = text.trim();

		// Buscar ubicaciones en la API de Kiwi
		const locations = await this.kiwiService.searchLocations(searchTerm);

		if (locations.length === 0) {
			await this.sendMessage(
				chatId,
				`❌ No se encontraron resultados para "<b>${searchTerm}</b>".

Intentá con otro nombre de ciudad o código IATA.`
			);
			return;
		}

		// Si solo hay un resultado, usarlo directamente
		if (locations.length === 1) {
			const loc = locations[0];
			state.data.origin = loc.id;
			state.data.originCode =
				loc.code ||
				loc.id.split(':')[1]?.split('_')[0]?.toUpperCase() ||
				searchTerm.toUpperCase();
			state.data.originName = loc.name;
			state.step = 'destination';
			this.conversationState.set(chatId, state);

			await this.sendMessage(
				chatId,
				`✅ Origen: <b>${state.data.originName}</b> (${state.data.originCode})

<b>Paso 2/6:</b> ¿Cuál es el <b>destino</b>?
Escribí el nombre de la ciudad o código IATA.`
			);
			return;
		}

		// Guardar estado para esperar selección
		state.step = 'origin_select';
		state.data.pendingLocations = locations;
		this.conversationState.set(chatId, state);

		// Mostrar opciones con inline keyboard
		const keyboard = locations.map((loc, index) => {
			const displayCode = loc.code || '';
			const displayName = loc.name + (displayCode ? ` (${displayCode})` : '');
			const locType =
				loc.type === 'city'
					? 'Todos los aeropuertos'
					: loc.type === 'airport'
						? 'Aeropuerto'
						: '';
			return [
				{
					text: `${displayName}${locType ? ' - ' + locType : ''}`,
					callback_data: `origin_select_${index}`,
				},
			];
		});

		await this.telegramService.bot.sendMessage(
			chatId,
			`Encontré ${locations.length} opciones para "<b>${searchTerm}</b>".\n\nSeleccioná el origen:`,
			{
				parse_mode: 'HTML',
				reply_markup: {inline_keyboard: keyboard},
			}
		);
	}

	async handleDestinationStep(chatId, text, state) {
		const searchTerm = text.trim();

		// Buscar ubicaciones en la API de Kiwi
		const locations = await this.kiwiService.searchLocations(searchTerm);

		if (locations.length === 0) {
			await this.sendMessage(
				chatId,
				`❌ No se encontraron resultados para "<b>${searchTerm}</b>".

Intentá con otro nombre de ciudad o código IATA.`
			);
			return;
		}

		// Si solo hay un resultado, usarlo directamente
		if (locations.length === 1) {
			const loc = locations[0];
			const destCode =
				loc.code ||
				loc.id.split(':')[1]?.split('_')[0]?.toUpperCase() ||
				searchTerm.toUpperCase();

			// Verificar que no sea igual al origen
			if (loc.id === state.data.origin) {
				await this.sendMessage(
					chatId,
					'❌ El destino no puede ser igual al origen.'
				);
				return;
			}

			state.data.destination = loc.id;
			state.data.destinationCode = destCode;
			state.data.destinationName = loc.name;
			state.step = 'outbound_dates';
			this.conversationState.set(chatId, state);

			await this.sendMessage(
				chatId,
				`✅ Destino: <b>${state.data.destinationName}</b> (${state.data.destinationCode})

<b>Paso 3/6:</b> ¿Fechas de <b>ida</b>?
Enviá el rango de fechas en formato:
<code>YYYY-MM-DD YYYY-MM-DD</code>

Ejemplo: <code>2026-05-01 2026-05-15</code>
(o una sola fecha si es fija)`
			);
			return;
		}

		// Guardar estado para esperar selección
		state.step = 'destination_select';
		state.data.pendingLocations = locations;
		this.conversationState.set(chatId, state);

		// Mostrar opciones con inline keyboard
		const keyboard = locations.map((loc, index) => {
			const displayCode = loc.code || '';
			const displayName = loc.name + (displayCode ? ` (${displayCode})` : '');
			const locType =
				loc.type === 'city'
					? 'Todos los aeropuertos'
					: loc.type === 'airport'
						? 'Aeropuerto'
						: '';
			return [
				{
					text: `${displayName}${locType ? ' - ' + locType : ''}`,
					callback_data: `dest_select_${index}`,
				},
			];
		});

		await this.telegramService.bot.sendMessage(
			chatId,
			`Encontré ${locations.length} opciones para "<b>${searchTerm}</b>".\n\nSeleccioná el destino:`,
			{
				parse_mode: 'HTML',
				reply_markup: {inline_keyboard: keyboard},
			}
		);
	}

	async handleOutboundDatesStep(chatId, text, state) {
		const dates = text.trim().split(/\s+/);
		const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

		if (!dateRegex.test(dates[0])) {
			await this.sendMessage(
				chatId,
				'❌ Formato inválido. Usa YYYY-MM-DD (ej: 2026-05-01)'
			);
			return;
		}

		const startDate = dates[0];
		const endDate = dates[1] && dateRegex.test(dates[1]) ? dates[1] : dates[0];

		// Validar que las fechas no sean en el pasado
		const today = new Date().toISOString().split('T')[0];
		if (startDate < today) {
			await this.sendMessage(
				chatId,
				'❌ La fecha de inicio no puede ser en el pasado.'
			);
			return;
		}

		// Validar que endDate no sea anterior a startDate
		if (endDate < startDate) {
			await this.sendMessage(
				chatId,
				'❌ La fecha de fin no puede ser anterior a la de inicio.'
			);
			return;
		}

		state.data.outboundDateRange = {
			startDate,
			endDate,
			flexible: startDate !== endDate,
		};
		state.step = 'inbound_dates';
		this.conversationState.set(chatId, state);

		await this.sendMessage(
			chatId,
			`✅ Ida: <b>${startDate}</b> a <b>${endDate}</b>

<b>Paso 4/6:</b> ¿Fechas de <b>vuelta</b>?
Enviá el rango de fechas en formato:
<code>YYYY-MM-DD YYYY-MM-DD</code>

Ejemplo: <code>2026-05-30 2026-06-10</code>
(escribe "solo ida" si no hay vuelta)`
		);
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
				await this.sendMessage(
					chatId,
					'❌ Formato inválido. Usa YYYY-MM-DD o escribe "solo ida"'
				);
				return;
			}

			const startDate = dates[0];
			const endDate =
				dates[1] && dateRegex.test(dates[1]) ? dates[1] : dates[0];

			// Validar que las fechas no sean en el pasado
			const today = new Date().toISOString().split('T')[0];
			if (startDate < today) {
				await this.sendMessage(
					chatId,
					'❌ La fecha de vuelta no puede ser en el pasado.'
				);
				return;
			}

			// Validar que endDate no sea anterior a startDate
			if (endDate < startDate) {
				await this.sendMessage(
					chatId,
					'❌ La fecha de fin no puede ser anterior a la de inicio.'
				);
				return;
			}

			// Validar que la vuelta sea después de la ida
			const outboundEnd = state.data.outboundDateRange.endDate;
			if (startDate < outboundEnd) {
				await this.sendMessage(
					chatId,
					`❌ La fecha de vuelta debe ser posterior a la ida (${outboundEnd}).`
				);
				return;
			}

			state.data.flightType = 'roundtrip';
			state.data.inboundDateRange = {
				startDate,
				endDate,
				flexible: startDate !== endDate,
			};
		}

		state.step = 'price';
		this.conversationState.set(chatId, state);

		const vueltaMsg =
			state.data.flightType === 'oneway'
				? '✅ Tipo: <b>Solo ida</b>'
				: `✅ Vuelta: <b>${state.data.inboundDateRange.startDate}</b> a <b>${state.data.inboundDateRange.endDate}</b>`;

		await this.sendMessage(
			chatId,
			`${vueltaMsg}

<b>Paso 5/6:</b> ¿Precio <b>umbral</b> en EUR?
Recibirás alertas cuando el precio sea menor a este valor.

Ejemplo: <code>800</code>`
		);
	}

	async handlePriceStep(chatId, text, state) {
		const price = parseInt(text.trim());

		if (isNaN(price) || price <= 0 || price > 10000) {
			await this.sendMessage(
				chatId,
				'❌ Precio inválido. Debe ser un número entre 1 y 10000.'
			);
			return;
		}

		state.data.priceThreshold = price;
		state.step = 'max_stops';
		this.conversationState.set(chatId, state);

		await this.sendMessage(
			chatId,
			`✅ Umbral: <b>€${price}</b>

<b>Paso 6/6:</b> ¿Máximo de <b>escalas</b>?
Enviá un número (0 = solo directos, 1, 2, etc.)

Ejemplo: <code>2</code>
(escribe "cualquiera" para no limitar)`
		);
	}

	async handleMaxStopsStep(chatId, text, state) {
		const input = text.trim().toLowerCase();

		if (input === 'cualquiera' || input === 'any' || input === '-') {
			state.data.maxStops = null;
		} else {
			const maxStops = parseInt(input);
			if (isNaN(maxStops) || maxStops < 0 || maxStops > 5) {
				await this.sendMessage(
					chatId,
					'❌ Valor inválido. Debe ser 0-5 o "cualquiera".'
				);
				return;
			}
			state.data.maxStops = maxStops;
		}

		state.step = 'confirm';
		this.conversationState.set(chatId, state);

		const stopsMsg =
			state.data.maxStops === null ? 'Sin límite' : state.data.maxStops;
		const flightTypeMsg =
			state.data.flightType === 'oneway' ? 'Solo ida' : 'Ida y vuelta';

		const originDisplay = `${state.data.originName} (${state.data.originCode})`;
		const destDisplay = `${state.data.destinationName} (${state.data.destinationCode})`;

		const summary = `📋 <b>Resumen del Monitor</b>

🛫 <b>Ruta:</b> ${originDisplay} → ${destDisplay}
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
				const monitorData = {
					name: `${state.data.originName} → ${state.data.destinationName}`,
					origin: state.data.origin, // Kiwi ID (ej: City:berlin_de)
					destination: state.data.destination, // Kiwi ID
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

				await this.sendMessage(
					chatId,
					`✅ <b>Monitor creado</b>

${state.data.originName} (${state.data.originCode}) → ${state.data.destinationName} (${state.data.destinationCode}) · Umbral €${monitor.priceThreshold}

Buscaremos vuelos cada 30 min. Te notificamos solo cuando el precio esté por debajo de tu umbral.`
				);

				console.log(
					`✅ Monitor creado desde Telegram: ${monitor.name} (${monitor._id})`
				);
			} catch (error) {
				console.error('❌ Error creando monitor:', error);
				await this.sendMessage(
					chatId,
					'❌ Error creando el monitor. Intenta nuevamente con /create'
				);
				this.conversationState.delete(chatId);
			}
		} else if (input === 'no' || input === 'n') {
			this.conversationState.delete(chatId);
			await this.sendMessage(
				chatId,
				'❌ Creación cancelada. Usa /create para empezar de nuevo.'
			);
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
			// Callbacks con formato especial (usersfilter_status_page, userspage_filter_page)
			if (data.startsWith('usersfilter_')) {
				const [, filter, page] = data.split('_');
				await this.handleUsersFilterCallback(
					chatId,
					messageId,
					filter,
					parseInt(page),
					callbackQuery.id
				);
				return;
			}
			if (data.startsWith('userspage_')) {
				const [, filter, page] = data.split('_');
				await this.handleUsersFilterCallback(
					chatId,
					messageId,
					filter,
					parseInt(page),
					callbackQuery.id
				);
				return;
			}
			if (data.startsWith('userselect_')) {
				const userChatId = data.replace('userselect_', '');
				await this.handleUserSelectCallback(
					chatId,
					messageId,
					userChatId,
					callbackQuery.id
				);
				return;
			}
			if (data.startsWith('userback_')) {
				const [, filter, page] = data.split('_');
				await this.handleUsersFilterCallback(
					chatId,
					messageId,
					filter,
					parseInt(page),
					callbackQuery.id
				);
				return;
			}
			if (data === 'noop') {
				await this.telegramService.bot.answerCallbackQuery(callbackQuery.id);
				return;
			}

			// Handlers para selección de aeropuertos
			if (data.startsWith('origin_select_')) {
				const index = parseInt(data.replace('origin_select_', ''));
				await this.handleOriginSelectCallback(chatId, index, callbackQuery.id);
				return;
			}
			if (data.startsWith('dest_select_')) {
				const index = parseInt(data.replace('dest_select_', ''));
				await this.handleDestSelectCallback(chatId, index, callbackQuery.id);
				return;
			}

			const [action, id] = data.split('_');

			switch (action) {
				case 'pause':
					await this.handlePauseCallback(
						chatId,
						messageId,
						id,
						callbackQuery.id
					);
					break;
				case 'resume':
					await this.handleResumeCallback(
						chatId,
						messageId,
						id,
						callbackQuery.id
					);
					break;
				case 'delete':
					await this.handleDeleteCallback(
						chatId,
						messageId,
						id,
						callbackQuery.id
					);
					break;
				case 'confirmdelete':
					await this.handleConfirmDeleteCallback(
						chatId,
						messageId,
						id,
						callbackQuery.id
					);
					break;
				case 'canceldelete':
					await this.handleCancelDeleteCallback(
						chatId,
						messageId,
						id,
						callbackQuery.id
					);
					break;
				case 'check':
					await this.handleCheckCallback(
						chatId,
						messageId,
						id,
						callbackQuery.id
					);
					break;
				case 'approve':
					await this.handleApproveUserCallback(
						chatId,
						messageId,
						id,
						callbackQuery.id
					);
					break;
				case 'reject':
					await this.handleRejectUserCallback(
						chatId,
						messageId,
						id,
						callbackQuery.id
					);
					break;
				case 'blockuser':
					await this.handleBlockUserCallback(
						chatId,
						messageId,
						id,
						callbackQuery.id
					);
					break;
				case 'unblockuser':
					await this.handleUnblockUserCallback(
						chatId,
						messageId,
						id,
						callbackQuery.id
					);
					break;
				case 'usermonitors':
					await this.handleUserMonitorsCallback(chatId, id, callbackQuery.id);
					break;
				case 'edit':
					await this.handleEditCallback(
						chatId,
						messageId,
						id,
						callbackQuery.id
					);
					break;
				case 'editprice':
					await this.handleEditFieldCallback(
						chatId,
						id,
						'price',
						callbackQuery.id
					);
					break;
				case 'editstops':
					await this.handleEditFieldCallback(
						chatId,
						id,
						'stops',
						callbackQuery.id
					);
					break;
				case 'editoutbound':
					await this.handleEditFieldCallback(
						chatId,
						id,
						'outbound',
						callbackQuery.id
					);
					break;
				case 'editinbound':
					await this.handleEditFieldCallback(
						chatId,
						id,
						'inbound',
						callbackQuery.id
					);
					break;
				case 'editback':
					await this.handleEditBackCallback(
						chatId,
						messageId,
						id,
						callbackQuery.id
					);
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

	async handleOriginSelectCallback(chatId, index, callbackId) {
		const state = this.conversationState.get(chatId.toString());

		if (
			!state ||
			state.step !== 'origin_select' ||
			!state.data.pendingLocations
		) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Sesión expirada. Usa /create para empezar de nuevo.',
			});
			return;
		}

		const loc = state.data.pendingLocations[index];
		if (!loc) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Opción no válida',
			});
			return;
		}

		// Guardar origen seleccionado
		state.data.origin = loc.id;
		state.data.originCode =
			loc.code || loc.id.split(':')[1]?.split('_')[0]?.toUpperCase();
		state.data.originName = loc.name;
		delete state.data.pendingLocations;
		state.step = 'destination';
		this.conversationState.set(chatId.toString(), state);

		await this.telegramService.bot.answerCallbackQuery(callbackId);

		await this.sendMessage(
			chatId,
			`✅ Origen: <b>${state.data.originName}</b> (${state.data.originCode})

<b>Paso 2/6:</b> ¿Cuál es el <b>destino</b>?
Escribí el nombre de la ciudad o código IATA.`
		);
	}

	async handleDestSelectCallback(chatId, index, callbackId) {
		const state = this.conversationState.get(chatId.toString());

		if (
			!state ||
			state.step !== 'destination_select' ||
			!state.data.pendingLocations
		) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Sesión expirada. Usa /create para empezar de nuevo.',
			});
			return;
		}

		const loc = state.data.pendingLocations[index];
		if (!loc) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Opción no válida',
			});
			return;
		}

		// Verificar que no sea igual al origen
		if (loc.id === state.data.origin) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'El destino no puede ser igual al origen',
			});
			return;
		}

		// Guardar destino seleccionado
		state.data.destination = loc.id;
		state.data.destinationCode =
			loc.code || loc.id.split(':')[1]?.split('_')[0]?.toUpperCase();
		state.data.destinationName = loc.name;
		delete state.data.pendingLocations;
		state.step = 'outbound_dates';
		this.conversationState.set(chatId.toString(), state);

		await this.telegramService.bot.answerCallbackQuery(callbackId);

		await this.sendMessage(
			chatId,
			`✅ Destino: <b>${state.data.destinationName}</b> (${state.data.destinationCode})

<b>Paso 3/6:</b> ¿Fechas de <b>ida</b>?
Enviá el rango de fechas en formato:
<code>YYYY-MM-DD YYYY-MM-DD</code>

Ejemplo: <code>2026-05-01 2026-05-15</code>
(o una sola fecha si es fija)`
		);
	}

	async handleApproveUserCallback(chatId, messageId, userChatId, callbackId) {
		const user = await User.findOne({chatId: userChatId});
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
			`<b>${displayName}</b>\nAprobado ✓`,
			{
				chat_id: chatId,
				message_id: messageId,
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[{text: '← Volver a usuarios', callback_data: 'usersfilter_all_0'}]
					]
				}
			}
		);

		// Notificar al usuario
		await this.telegramService.bot.sendMessage(
			userChatId,
			`<b>Cuenta aprobada</b>

Tu cuenta fue aprobada. Ya podés usar el bot.

Usa /help para ver los comandos disponibles.

<i>Dudas o sugerencias? Contacta a @pavegliobruno</i>`,
			{parse_mode: 'HTML'}
		);

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Usuario aprobado',
		});

		console.log(`Usuario aprobado: ${displayName}`);
	}

	async handleRejectUserCallback(chatId, messageId, userChatId, callbackId) {
		const user = await User.findOne({chatId: userChatId});
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
				reply_markup: {
					inline_keyboard: [
						[{text: '← Volver a usuarios', callback_data: 'usersfilter_all_0'}]
					]
				}
			}
		);

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Usuario rechazado',
		});

		console.log(`Usuario rechazado: ${displayName}`);
	}

	async handleBlockUserCallback(chatId, messageId, userChatId, callbackId) {
		const user = await User.findOne({chatId: userChatId});
		if (!user) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Usuario no encontrado',
			});
			return;
		}

		user.status = 'blocked';
		await user.save();

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Usuario bloqueado',
		});

		// Actualizar vista del usuario
		await this.refreshUserDetailView(chatId, messageId, user);
	}

	async handleUnblockUserCallback(chatId, messageId, userChatId, callbackId) {
		const user = await User.findOne({chatId: userChatId});
		if (!user) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Usuario no encontrado',
			});
			return;
		}

		user.status = 'active';
		await user.save();

		await this.telegramService.bot.answerCallbackQuery(callbackId, {
			text: 'Usuario desbloqueado',
		});

		// Actualizar vista del usuario
		await this.refreshUserDetailView(chatId, messageId, user);
	}

	async refreshUserDetailView(chatId, messageId, user) {
		const monitorCount = await RouteMonitor.countDocuments({
			'notifications.telegram.chatId': user.chatId,
		});

		const displayName = user.firstName
			? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
			: user.username || `ID:${user.chatId}`;

		const statusText = {
			active: 'Activo',
			pending: 'Pendiente',
			blocked: 'Bloqueado',
		}[user.status];

		let message = `<b>${displayName}</b>\n`;
		message += user.username ? `@${user.username}\n` : '';
		message += `Estado: ${statusText}\n`;
		message += `Monitores: ${monitorCount}\n`;
		message += `ID: <code>${user.chatId}</code>`;

		const buttons = [];

		if (user.status === 'active') {
			buttons.push([
				{text: 'Ver monitores', callback_data: `usermonitors_${user.chatId}`},
				{text: 'Bloquear', callback_data: `blockuser_${user.chatId}`},
			]);
		} else if (user.status === 'blocked') {
			buttons.push([
				{text: 'Desbloquear', callback_data: `unblockuser_${user.chatId}`},
			]);
		} else if (user.status === 'pending') {
			buttons.push([
				{text: 'Aprobar', callback_data: `approve_${user.chatId}`},
				{text: 'Rechazar', callback_data: `reject_${user.chatId}`},
			]);
		}

		buttons.push([{text: '← Volver a lista', callback_data: `userback_all_0`}]);

		await this.telegramService.bot.editMessageText(message, {
			chat_id: chatId,
			message_id: messageId,
			parse_mode: 'HTML',
			reply_markup: {inline_keyboard: buttons},
		});
	}

	async handleUsersFilterCallback(chatId, messageId, filter, page, callbackId) {
		await this.telegramService.bot.answerCallbackQuery(callbackId);

		const USERS_PER_PAGE = 10;

		// Filtro de estado
		const statusFilter = filter === 'all' ? {} : {status: filter};
		const query = {isAdmin: false, ...statusFilter};

		// Obtener usuarios con conteo de monitores
		const users = await User.find(query).lean();

		const usersWithMonitors = await Promise.all(
			users.map(async (user) => {
				const monitorCount = await RouteMonitor.countDocuments({
					'notifications.telegram.chatId': user.chatId,
				});
				return {...user, monitorCount};
			})
		);

		// Ordenar por cantidad de monitores (descendente)
		usersWithMonitors.sort((a, b) => b.monitorCount - a.monitorCount);

		if (usersWithMonitors.length === 0) {
			// Obtener conteos para mostrar en el mensaje
			const allUsers = await User.find({isAdmin: false});
			const activeCount = allUsers.filter((u) => u.status === 'active').length;
			const pendingCount = allUsers.filter((u) => u.status === 'pending').length;
			const blockedCount = allUsers.filter((u) => u.status === 'blocked').length;

			const filterLabel = {
				all: 'Todos',
				active: 'Activos',
				pending: 'Pendientes',
				blocked: 'Bloqueados',
			}[filter];

			const filterButtons = [
				{text: filter === 'all' ? '• Todos' : 'Todos', callback_data: 'usersfilter_all_0'},
				{text: filter === 'active' ? '• Activos' : 'Activos', callback_data: 'usersfilter_active_0'},
				{text: filter === 'pending' ? '• Pend.' : 'Pend.', callback_data: 'usersfilter_pending_0'},
				{text: filter === 'blocked' ? '• Bloq.' : 'Bloq.', callback_data: 'usersfilter_blocked_0'},
			];

			await this.telegramService.bot.editMessageText(
				`<b>Usuarios</b> (${filterLabel}: 0)\n━━━━━━━━━━━━━━━━\n<i>No hay usuarios con este filtro</i>\n\n<i>Total: ${allUsers.length} (${activeCount} activos, ${pendingCount} pend., ${blockedCount} bloq.)</i>`,
				{
					chat_id: chatId,
					message_id: messageId,
					parse_mode: 'HTML',
					reply_markup: {inline_keyboard: [filterButtons]},
				}
			);
			return;
		}

		// Calcular paginación
		const totalPages = Math.ceil(usersWithMonitors.length / USERS_PER_PAGE);
		const currentPage = Math.min(page, totalPages - 1);
		const startIdx = currentPage * USERS_PER_PAGE;
		const pageUsers = usersWithMonitors.slice(
			startIdx,
			startIdx + USERS_PER_PAGE
		);

		// Conteos por estado
		const allUsers = await User.find({isAdmin: false});
		const activeCount = allUsers.filter((u) => u.status === 'active').length;
		const pendingCount = allUsers.filter((u) => u.status === 'pending').length;
		const blockedCount = allUsers.filter((u) => u.status === 'blocked').length;

		const filterLabel = {
			all: 'Todos',
			active: 'Activos',
			pending: 'Pendientes',
			blocked: 'Bloqueados',
		}[filter];

		let message = `<b>Usuarios</b> (${filterLabel}: ${usersWithMonitors.length})\n`;
		message += `━━━━━━━━━━━━━━━━\n`;

		pageUsers.forEach((user, idx) => {
			const globalIdx = startIdx + idx + 1;
			const displayName = user.firstName
				? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
				: user.username || `ID:${user.chatId}`;
			const username = user.username ? ` @${user.username}` : '';
			const statusIcon = {
				active: '●',
				pending: '○',
				blocked: '✕',
			}[user.status];

			message += `${globalIdx}. ${statusIcon} ${displayName}${username} · ${user.monitorCount} mon.\n`;
		});

		message += `\n<i>Total: ${allUsers.length} (${activeCount} activos, ${pendingCount} pend., ${blockedCount} bloq.)</i>`;

		// Botones de filtro
		const filterButtons = [
			{
				text: filter === 'all' ? '• Todos' : 'Todos',
				callback_data: 'usersfilter_all_0',
			},
			{
				text: filter === 'active' ? '• Activos' : 'Activos',
				callback_data: 'usersfilter_active_0',
			},
			{
				text: filter === 'pending' ? '• Pend.' : 'Pend.',
				callback_data: 'usersfilter_pending_0',
			},
			{
				text: filter === 'blocked' ? '• Bloq.' : 'Bloq.',
				callback_data: 'usersfilter_blocked_0',
			},
		];

		// Botones de paginación
		const navButtons = [];
		if (currentPage > 0) {
			navButtons.push({
				text: '← Anterior',
				callback_data: `userspage_${filter}_${currentPage - 1}`,
			});
		}
		navButtons.push({
			text: `${currentPage + 1}/${totalPages}`,
			callback_data: 'noop',
		});
		if (currentPage < totalPages - 1) {
			navButtons.push({
				text: 'Siguiente →',
				callback_data: `userspage_${filter}_${currentPage + 1}`,
			});
		}

		// Botones para seleccionar usuario
		const userSelectButtons = [];
		for (let i = 0; i < pageUsers.length; i += 5) {
			const row = pageUsers.slice(i, i + 5).map((user, idx) => ({
				text: `${startIdx + i + idx + 1}`,
				callback_data: `userselect_${user.chatId}_${filter}_${currentPage}`,
			}));
			userSelectButtons.push(row);
		}

		const keyboard = [filterButtons, ...userSelectButtons, navButtons];

		await this.telegramService.bot.editMessageText(message, {
			chat_id: chatId,
			message_id: messageId,
			parse_mode: 'HTML',
			reply_markup: {inline_keyboard: keyboard},
		});
	}

	async handleUserSelectCallback(chatId, messageId, userChatId, callbackId) {
		// Parsear datos del callback (userselect_chatId_filter_page)
		const parts = userChatId.split('_');
		const actualChatId = parts[0];
		const filter = parts[1] || 'all';
		const page = parseInt(parts[2]) || 0;

		const user = await User.findOne({chatId: actualChatId});
		if (!user) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Usuario no encontrado',
			});
			return;
		}

		await this.telegramService.bot.answerCallbackQuery(callbackId);

		const monitorCount = await RouteMonitor.countDocuments({
			'notifications.telegram.chatId': actualChatId,
		});

		const displayName = user.firstName
			? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
			: user.username || `ID:${user.chatId}`;

		const statusText = {
			active: 'Activo',
			pending: 'Pendiente',
			blocked: 'Bloqueado',
		}[user.status];

		let message = `<b>${displayName}</b>\n`;
		message += user.username ? `@${user.username}\n` : '';
		message += `Estado: ${statusText}\n`;
		message += `Monitores: ${monitorCount}\n`;
		message += `ID: <code>${user.chatId}</code>`;

		const buttons = [];

		// Acciones según estado
		if (user.status === 'active') {
			buttons.push([
				{text: 'Ver monitores', callback_data: `usermonitors_${actualChatId}`},
				{text: 'Bloquear', callback_data: `blockuser_${actualChatId}`},
			]);
		} else if (user.status === 'blocked') {
			buttons.push([
				{text: 'Desbloquear', callback_data: `unblockuser_${actualChatId}`},
			]);
		} else if (user.status === 'pending') {
			buttons.push([
				{text: 'Aprobar', callback_data: `approve_${actualChatId}`},
				{text: 'Rechazar', callback_data: `reject_${actualChatId}`},
			]);
		}

		buttons.push([
			{text: '← Volver a lista', callback_data: `userback_${filter}_${page}`},
		]);

		await this.telegramService.bot.editMessageText(message, {
			chat_id: chatId,
			message_id: messageId,
			parse_mode: 'HTML',
			reply_markup: {inline_keyboard: buttons},
		});
	}

	async handleUserMonitorsCallback(chatId, userChatId, callbackId) {
		const user = await User.findOne({chatId: userChatId});
		if (!user) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Usuario no encontrado',
			});
			return;
		}

		await this.telegramService.bot.answerCallbackQuery(callbackId);

		const displayName = user.firstName || user.username || user.chatId;
		const monitors = await RouteMonitor.find({
			'notifications.telegram.chatId': userChatId,
		}).sort({createdAt: -1});

		if (monitors.length === 0) {
			await this.sendMessage(
				chatId,
				`<b>${displayName}</b> no tiene monitores.`
			);
			return;
		}

		await this.sendMessage(chatId, `Monitores de <b>${displayName}</b>:`);

		for (const monitor of monitors) {
			await this.sendMonitorCard(chatId, monitor);
		}
	}

	async handleEditCallback(chatId, messageId, monitorId, callbackId) {
		const monitor = await RouteMonitor.findById(monitorId);
		if (!monitor) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Monitor no encontrado',
			});
			return;
		}

		const outbound = monitor.outboundDateRange;
		const inbound = monitor.inboundDateRange;
		const stopsText =
			monitor.maxStops === null ? 'Sin límite' : monitor.maxStops;

		const message = `<b>Editar: ${monitor.name}</b>

Precio umbral: €${monitor.priceThreshold}
Escalas máx: ${stopsText}
Ida: ${this.formatShortDate(outbound?.startDate)} - ${this.formatShortDate(outbound?.endDate)}
${inbound ? `Vuelta: ${this.formatShortDate(inbound?.startDate)} - ${this.formatShortDate(inbound?.endDate)}` : ''}

¿Qué querés editar?`;

		const buttons = [
			[
				{text: 'Precio', callback_data: `editprice_${monitorId}`},
				{text: 'Escalas', callback_data: `editstops_${monitorId}`},
			],
			[{text: 'Fechas ida', callback_data: `editoutbound_${monitorId}`}],
		];

		if (monitor.flightType === 'roundtrip') {
			buttons[1].push({
				text: 'Fechas vuelta',
				callback_data: `editinbound_${monitorId}`,
			});
		}

		buttons.push([{text: '← Volver', callback_data: `editback_${monitorId}`}]);

		await this.telegramService.bot.editMessageText(message, {
			chat_id: chatId,
			message_id: messageId,
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: buttons,
			},
		});

		await this.telegramService.bot.answerCallbackQuery(callbackId);
	}

	async handleEditFieldCallback(chatId, monitorId, field, callbackId) {
		const monitor = await RouteMonitor.findById(monitorId);
		if (!monitor) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Monitor no encontrado',
			});
			return;
		}

		await this.telegramService.bot.answerCallbackQuery(callbackId);

		// Guardar estado de edición
		this.conversationState.set(chatId.toString(), {
			step: `edit_${field}`,
			data: {monitorId},
		});

		const prompts = {
			price: `Ingresá el nuevo precio umbral en EUR:\n\nActual: €${monitor.priceThreshold}`,
			stops: `Ingresá el máximo de escalas (0-5) o "cualquiera":\n\nActual: ${monitor.maxStops === null ? 'Sin límite' : monitor.maxStops}`,
			outbound: `Ingresá las nuevas fechas de ida:\n<code>YYYY-MM-DD YYYY-MM-DD</code>\n\nActual: ${this.formatShortDate(monitor.outboundDateRange?.startDate)} - ${this.formatShortDate(monitor.outboundDateRange?.endDate)}`,
			inbound: `Ingresá las nuevas fechas de vuelta:\n<code>YYYY-MM-DD YYYY-MM-DD</code>\n\nActual: ${this.formatShortDate(monitor.inboundDateRange?.startDate)} - ${this.formatShortDate(monitor.inboundDateRange?.endDate)}`,
		};

		await this.sendMessage(chatId, prompts[field]);
	}

	async handleEditPriceStep(chatId, text, state) {
		const price = parseInt(text.trim());

		if (isNaN(price) || price <= 0 || price > 10000) {
			await this.sendMessage(
				chatId,
				'Precio inválido. Debe ser un número entre 1 y 10000.'
			);
			return;
		}

		const monitor = await RouteMonitor.findById(state.data.monitorId);
		if (!monitor) {
			await this.sendMessage(chatId, 'Monitor no encontrado.');
			this.conversationState.delete(chatId);
			return;
		}

		monitor.priceThreshold = price;
		await monitor.save();

		this.conversationState.delete(chatId);
		await this.sendMessage(chatId, `Precio actualizado a €${price}`);
	}

	async handleEditStopsStep(chatId, text, state) {
		const input = text.trim().toLowerCase();
		let maxStops;

		if (input === 'cualquiera' || input === 'any' || input === '-') {
			maxStops = null;
		} else {
			maxStops = parseInt(input);
			if (isNaN(maxStops) || maxStops < 0 || maxStops > 5) {
				await this.sendMessage(
					chatId,
					'Valor inválido. Debe ser 0-5 o "cualquiera".'
				);
				return;
			}
		}

		const monitor = await RouteMonitor.findById(state.data.monitorId);
		if (!monitor) {
			await this.sendMessage(chatId, 'Monitor no encontrado.');
			this.conversationState.delete(chatId);
			return;
		}

		monitor.maxStops = maxStops;
		await monitor.save();

		this.conversationState.delete(chatId);
		await this.sendMessage(
			chatId,
			`Escalas máximas actualizado a ${maxStops === null ? 'sin límite' : maxStops}`
		);
	}

	async handleEditOutboundStep(chatId, text, state) {
		const dates = text.trim().split(/\s+/);
		const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

		if (!dateRegex.test(dates[0])) {
			await this.sendMessage(
				chatId,
				'Formato inválido. Usa YYYY-MM-DD (ej: 2026-05-01)'
			);
			return;
		}

		const startDate = dates[0];
		const endDate = dates[1] && dateRegex.test(dates[1]) ? dates[1] : dates[0];

		// Validar que las fechas no sean en el pasado
		const today = new Date().toISOString().split('T')[0];
		if (startDate < today) {
			await this.sendMessage(chatId, '❌ La fecha no puede ser en el pasado.');
			return;
		}

		// Validar que endDate no sea anterior a startDate
		if (endDate < startDate) {
			await this.sendMessage(chatId, '❌ La fecha de fin no puede ser anterior a la de inicio.');
			return;
		}

		const monitor = await RouteMonitor.findById(state.data.monitorId);
		if (!monitor) {
			await this.sendMessage(chatId, 'Monitor no encontrado.');
			this.conversationState.delete(chatId);
			return;
		}

		monitor.outboundDateRange = {
			startDate,
			endDate,
			flexible: startDate !== endDate,
		};
		await monitor.save();

		this.conversationState.delete(chatId);
		await this.sendMessage(
			chatId,
			`Fechas de ida actualizadas: ${this.formatShortDate(startDate)} - ${this.formatShortDate(endDate)}`
		);
	}

	async handleEditInboundStep(chatId, text, state) {
		const dates = text.trim().split(/\s+/);
		const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

		if (!dateRegex.test(dates[0])) {
			await this.sendMessage(
				chatId,
				'Formato inválido. Usa YYYY-MM-DD (ej: 2026-05-30)'
			);
			return;
		}

		const startDate = dates[0];
		const endDate = dates[1] && dateRegex.test(dates[1]) ? dates[1] : dates[0];

		// Validar que las fechas no sean en el pasado
		const today = new Date().toISOString().split('T')[0];
		if (startDate < today) {
			await this.sendMessage(chatId, '❌ La fecha no puede ser en el pasado.');
			return;
		}

		// Validar que endDate no sea anterior a startDate
		if (endDate < startDate) {
			await this.sendMessage(chatId, '❌ La fecha de fin no puede ser anterior a la de inicio.');
			return;
		}

		const monitor = await RouteMonitor.findById(state.data.monitorId);
		if (!monitor) {
			await this.sendMessage(chatId, 'Monitor no encontrado.');
			this.conversationState.delete(chatId);
			return;
		}

		// Validar que la vuelta sea después de la ida
		const outboundEnd = monitor.outboundDateRange?.endDate;
		if (outboundEnd && startDate < outboundEnd) {
			await this.sendMessage(
				chatId,
				`❌ La fecha de vuelta debe ser posterior a la ida (${outboundEnd}).`
			);
			return;
		}

		monitor.inboundDateRange = {
			startDate,
			endDate,
			flexible: startDate !== endDate,
		};
		await monitor.save();

		this.conversationState.delete(chatId);
		await this.sendMessage(
			chatId,
			`Fechas de vuelta actualizadas: ${this.formatShortDate(startDate)} - ${this.formatShortDate(endDate)}`
		);
	}

	async handleEditBackCallback(chatId, messageId, monitorId, callbackId) {
		const monitor = await RouteMonitor.findById(monitorId);
		if (!monitor) {
			await this.telegramService.bot.answerCallbackQuery(callbackId, {
				text: 'Monitor no encontrado',
			});
			return;
		}

		// Restaurar tarjeta del monitor
		const status = monitor.isActive ? 'Activo' : 'Pausado';
		const bestPrice = monitor.bestPrice?.amount
			? `€${Math.round(monitor.bestPrice.amount)}`
			: '-';
		const alertsSent = monitor.stats?.alertsSent || 0;

		const outbound = monitor.outboundDateRange;
		const inbound = monitor.inboundDateRange;
		const idaStr = outbound
			? `${this.formatShortDate(outbound.startDate)} - ${this.formatShortDate(outbound.endDate)}`
			: '-';
		const vueltaStr = inbound
			? `${this.formatShortDate(inbound.startDate)} - ${this.formatShortDate(inbound.endDate)}`
			: '';

		let message = `<b>${monitor.name}</b>
${monitor.origin} → ${monitor.destination}
Ida: ${idaStr}`;

		if (monitor.flightType === 'roundtrip' && vueltaStr) {
			message += `\nVuelta: ${vueltaStr}`;
		}

		message += `\nUmbral: €${monitor.priceThreshold} | Mejor: ${bestPrice} | ${status}`;
		message += `\n📬 Ofertas enviadas: ${alertsSent}`;

		const buttons = [];

		if (monitor.isActive) {
			buttons.push([
				{text: 'Pausar', callback_data: `pause_${monitor._id}`},
				{text: 'Buscar', callback_data: `check_${monitor._id}`},
			]);
		} else {
			buttons.push([
				{text: 'Reanudar', callback_data: `resume_${monitor._id}`},
				{text: 'Buscar', callback_data: `check_${monitor._id}`},
			]);
		}

		buttons.push([
			{text: 'Editar', callback_data: `edit_${monitor._id}`},
			{text: 'Eliminar', callback_data: `delete_${monitor._id}`},
		]);

		await this.telegramService.bot.editMessageText(message, {
			chat_id: chatId,
			message_id: messageId,
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: buttons,
			},
		});

		await this.telegramService.bot.answerCallbackQuery(callbackId);
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
						{text: 'Sí, eliminar', callback_data: `confirmdelete_${monitorId}`},
						{text: 'Cancelar', callback_data: `canceldelete_${monitorId}`},
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
			await this.telegramService.bot.sendMessage(
				chatId,
				`Búsqueda completada: <b>${monitor.name}</b>`,
				{parse_mode: 'HTML'}
			);
		} catch (error) {
			console.error('Error en búsqueda manual:', error);
			await this.telegramService.bot.sendMessage(
				chatId,
				`Error buscando vuelos para ${monitor.name}`,
				{parse_mode: 'HTML'}
			);
		}

		console.log(`Búsqueda manual iniciada: ${monitor.name}`);
	}

	async updateMonitorCard(chatId, messageId, monitor) {
		const status = monitor.isActive ? 'Activo' : 'Pausado';
		const bestPrice = monitor.bestPrice?.amount
			? `€${Math.round(monitor.bestPrice.amount)}`
			: '-';
		const alertsSent = monitor.stats?.alertsSent || 0;

		const outbound = monitor.outboundDateRange;
		const inbound = monitor.inboundDateRange;
		const idaStr = outbound
			? `${this.formatShortDate(outbound.startDate)} - ${this.formatShortDate(outbound.endDate)}`
			: '-';
		const vueltaStr = inbound
			? `${this.formatShortDate(inbound.startDate)} - ${this.formatShortDate(inbound.endDate)}`
			: '';

		let message = `<b>${monitor.name}</b>
${monitor.origin} → ${monitor.destination}
Ida: ${idaStr}`;

		if (monitor.flightType === 'roundtrip' && vueltaStr) {
			message += `\nVuelta: ${vueltaStr}`;
		}

		message += `\nUmbral: €${monitor.priceThreshold} | Mejor: ${bestPrice} | ${status}`;
		message += `\n📬 Ofertas enviadas: ${alertsSent}`;

		const buttons = [];

		if (monitor.isActive) {
			buttons.push([
				{text: 'Pausar', callback_data: `pause_${monitor._id}`},
				{text: 'Buscar', callback_data: `check_${monitor._id}`},
				{text: 'Eliminar', callback_data: `delete_${monitor._id}`},
			]);
		} else {
			buttons.push([
				{text: 'Reanudar', callback_data: `resume_${monitor._id}`},
				{text: 'Buscar', callback_data: `check_${monitor._id}`},
				{text: 'Eliminar', callback_data: `delete_${monitor._id}`},
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
