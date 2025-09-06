const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
	{
		// Información del usuario de Telegram
		telegramId: {
			type: String,
			required: true,
			unique: true,
		},
		username: {
			type: String,
			trim: true,
		},
		firstName: {
			type: String,
			trim: true,
		},
		lastName: {
			type: String,
			trim: true,
		},

		// Configuración personal
		preferences: {
			defaultCurrency: {
				type: String,
				default: 'EUR',
				enum: ['EUR', 'USD', 'ARS'],
			},
			timezone: {
				type: String,
				default: 'Europe/Berlin',
			},
			language: {
				type: String,
				default: 'es',
				enum: ['es', 'en'],
			},
			notifications: {
				enabled: {
					type: Boolean,
					default: true,
				},
				cooldownMinutes: {
					type: Number,
					default: 60,
					min: 15,
					max: 480, // Máximo 8 horas
				},
				quietHours: {
					enabled: {
						type: Boolean,
						default: false,
					},
					start: {
						type: String,
						default: '23:00',
					},
					end: {
						type: String,
						default: '07:00',
					},
				},
			},
		},

		// Estado del usuario
		isActive: {
			type: Boolean,
			default: true,
		},

		// Estadísticas del usuario
		stats: {
			totalMonitors: {
				type: Number,
				default: 0,
			},
			activeMonitors: {
				type: Number,
				default: 0,
			},
			alertsReceived: {
				type: Number,
				default: 0,
			},
			bestDealFound: {
				amount: Number,
				currency: String,
				route: String,
				foundAt: Date,
			},
		},

		// Información de registro
		registeredAt: {
			type: Date,
			default: Date.now,
		},
		lastActivity: {
			type: Date,
			default: Date.now,
		},

		// Límites (para evitar spam)
		limits: {
			maxMonitors: {
				type: Number,
				default: 2, // Máximo 2 monitores por usuario
			},
			maxAlertsPerDay: {
				type: Number,
				default: 20, // Máximo 20 alertas por día
			},
			alertsToday: {
				count: {
					type: Number,
					default: 0,
				},
				date: {
					type: String,
					default: () => new Date().toISOString().split('T')[0],
				},
			},
		},
	},
	{
		timestamps: true,
	}
);

// Índices
userSchema.index({telegramId: 1});
userSchema.index({isActive: 1});
userSchema.index({lastActivity: 1});

// Método para actualizar última actividad
userSchema.methods.updateActivity = function () {
	this.lastActivity = new Date();
	return this.save();
};

// Método para verificar si puede crear más monitores
userSchema.methods.canCreateMonitor = function () {
	return this.stats.activeMonitors < this.limits.maxMonitors;
};

// Método para verificar si puede recibir más alertas hoy
userSchema.methods.canReceiveAlert = function () {
	const today = new Date().toISOString().split('T')[0];

	// Resetear contador si es un nuevo día
	if (this.limits.alertsToday.date !== today) {
		this.limits.alertsToday.count = 0;
		this.limits.alertsToday.date = today;
	}

	return this.limits.alertsToday.count < this.limits.maxAlertsPerDay;
};

// Método para incrementar contador de alertas
userSchema.methods.incrementAlertCount = function () {
	const today = new Date().toISOString().split('T')[0];

	if (this.limits.alertsToday.date !== today) {
		this.limits.alertsToday.count = 1;
		this.limits.alertsToday.date = today;
	} else {
		this.limits.alertsToday.count += 1;
	}

	this.stats.alertsReceived += 1;
	return this.save();
};

// Método para actualizar estadísticas
userSchema.methods.updateStats = function () {
	// Este método se llamará cuando se actualicen los monitores
	// Se puede implementar en el futuro para calcular stats en tiempo real
	return this.save();
};

// Método para verificar si está en horas silenciosas
userSchema.methods.isInQuietHours = function () {
	if (!this.preferences.notifications.quietHours.enabled) {
		return false;
	}

	const now = new Date();
	const currentTime = now.toTimeString().slice(0, 5); // HH:MM
	const start = this.preferences.notifications.quietHours.start;
	const end = this.preferences.notifications.quietHours.end;

	// Si start > end, significa que cruza medianoche (ej: 23:00 a 07:00)
	if (start > end) {
		return currentTime >= start || currentTime <= end;
	} else {
		return currentTime >= start && currentTime <= end;
	}
};

// Método estático para encontrar o crear usuario
userSchema.statics.findOrCreate = async function (telegramUser) {
	try {
		let user = await this.findOne({telegramId: telegramUser.id.toString()});

		if (!user) {
			user = new this({
				telegramId: telegramUser.id.toString(),
				username: telegramUser.username,
				firstName: telegramUser.first_name,
				lastName: telegramUser.last_name,
			});

			await user.save();
			console.log(
				`👤 Nuevo usuario registrado: ${user.firstName} (@${user.username})`
			);
		} else {
			// Actualizar información si cambió
			let hasChanges = false;

			if (user.username !== telegramUser.username) {
				user.username = telegramUser.username;
				hasChanges = true;
			}
			if (user.firstName !== telegramUser.first_name) {
				user.firstName = telegramUser.first_name;
				hasChanges = true;
			}
			if (user.lastName !== telegramUser.last_name) {
				user.lastName = telegramUser.last_name;
				hasChanges = true;
			}

			if (hasChanges) {
				await user.save();
				console.log(
					`👤 Usuario actualizado: ${user.firstName} (@${user.username})`
				);
			}
		}

		// Actualizar última actividad
		await user.updateActivity();

		return user;
	} catch (error) {
		console.error('❌ Error en findOrCreate:', error);
		throw error;
	}
};

module.exports = mongoose.model('User', userSchema);
