const cron = require('node-cron');
const KiwiService = require('./kiwi.service');
const TelegramService = require('./telegram.service');
const RouteMonitor = require('../models/routeMonitor.models');
const Flight = require('../models/flight.model');
const User = require('../models/user.model');

class MonitoringService {
	constructor() {
		this.kiwiService = new KiwiService();
		this.telegramService = new TelegramService();
		this.isRunning = false;
		this.stats = {
			checksToday: 0,
			alertsToday: 0,
			errorsToday: 0,
			lastRun: null,
		};
	}

	start() {
		if (process.env.ENABLE_MONITORING !== 'true') {
			console.log('⏸️  Monitoreo deshabilitado (ENABLE_MONITORING=false)');
			return;
		}

		console.log('🚀 Iniciando servicio de monitoreo automático...');
		this.isRunning = true;

		// Ejecutar cada X minutos (configurable)
		const interval = process.env.MONITORING_INTERVAL || 30;
		const cronExpression = `*/${interval} * * * *`; // Cada X minutos

		console.log(`⏰ Programado para ejecutar cada ${interval} minutos`);

		// Cron job principal
		cron.schedule(
			cronExpression,
			async () => {
				if (this.isRunning) {
					await this.runMonitoringCycle();
				}
			},
			{
				scheduled: true,
				timezone: 'America/Argentina/Buenos_Aires',
			}
		);

		// Reporte diario a las 9 AM
		cron.schedule(
			'0 9 * * *',
			async () => {
				await this.sendDailyReport();
				this.resetDailyStats();
			},
			{
				scheduled: true,
				timezone: 'America/Argentina/Buenos_Aires',
			}
		);

		// Ejecución inicial después de 1 minuto
		setTimeout(() => {
			this.runMonitoringCycle();
		}, 60000);
	}

	stop() {
		this.isRunning = false;
		console.log('⏹️  Servicio de monitoreo detenido');
	}

	async runMonitoringCycle() {
		try {
			console.log('\n🔍 === INICIO CICLO DE MONITOREO ===');
			const startTime = Date.now();

			// Obtener rutas activas con información del usuario
			const routesToCheck = await RouteMonitor.find({
				isActive: true,
				$or: [
					{lastChecked: null},
					{
						lastChecked: {
							$lt: new Date(
								Date.now() -
									parseInt(process.env.MONITORING_INTERVAL || 30) * 60 * 1000
							),
						},
					},
				],
			}).populate('userId');

			console.log(`📋 Rutas a verificar: ${routesToCheck.length}`);

			if (routesToCheck.length === 0) {
				console.log('✅ No hay rutas para verificar en este momento');
				return;
			}

			// Agrupar rutas por usuario para optimizar notificaciones
			const userRoutes = {};
			routesToCheck.forEach((route) => {
				const userId = route.userId._id.toString();
				if (!userRoutes[userId]) {
					userRoutes[userId] = {
						user: route.userId,
						routes: [],
					};
				}
				userRoutes[userId].routes.push(route);
			});

			console.log(
				`👥 Usuarios con rutas activas: ${Object.keys(userRoutes).length}`
			);

			// Procesar cada usuario
			for (const [userId, userData] of Object.entries(userRoutes)) {
				const {user, routes} = userData;

				console.log(
					`\n👤 Procesando ${routes.length} rutas de ${user.firstName} (@${user.username})`
				);

				if (!user.canReceiveAlert()) {
					console.log(
						`⚠️ Usuario ${user.firstName} ha alcanzado el límite de alertas diarias`
					);
					continue;
				}

				for (const route of routes) {
					try {
						await this.checkRoute(route, user);

						await this.delay(5000);
					} catch (error) {
						console.error(
							`❌ Error verificando ruta ${route.name} de ${user.firstName}:`,
							error.message
						);
						this.stats.errorsToday++;
					}
				}

				// Delay entre usuarios
				await this.delay(2000);
			}

			const duration = ((Date.now() - startTime) / 1000).toFixed(2);
			console.log(`✅ === FIN CICLO DE MONITOREO (${duration}s) ===\n`);

			this.stats.lastRun = new Date();
		} catch (error) {
			console.error('❌ Error en ciclo de monitoreo:', error);
			this.stats.errorsToday++;
		}
	}

	// Ahora recibe el usuario como parámetro
	async checkRoute(routeMonitor, user) {
		try {
			console.log(
				`🔎 Verificando: ${routeMonitor.name} (${routeMonitor.origin} → ${routeMonitor.destination}) - ${user.firstName}`
			);

			this.stats.checksToday++;
			routeMonitor.lastChecked = new Date();

			// Obtener fechas de búsqueda usando el método del modelo
			const searchDates = routeMonitor.getSearchDates();

			let allFlights = [];
			let bestPrice = null;

			// Buscar combinaciones de ida y vuelta
			if (
				routeMonitor.flightType === 'roundtrip' &&
				searchDates.inbound.length > 0
			) {
				// Buscar todas las combinaciones de ida y vuelta
				for (const outboundDate of searchDates.outbound) {
					for (const inboundDate of searchDates.inbound) {
						try {
							const searchParams = {
								origin: routeMonitor.origin,
								destination: routeMonitor.destination,
								departureDate: outboundDate,
								returnDate: inboundDate,
								passengers: routeMonitor.passengers,
							};

							const rawData =
								await this.kiwiService.searchFlights(searchParams);
							const flights = this.kiwiService.parseFlightData(
								rawData,
								searchParams
							);

							if (flights && flights.length > 0) {
								allFlights.push(...flights);

								const cheapestFlight = flights.reduce((min, flight) =>
									flight.price.amount < min.price.amount ? flight : min
								);

								if (
									!bestPrice ||
									cheapestFlight.price.amount < bestPrice.price.amount
								) {
									bestPrice = cheapestFlight;
								}
							}

							await this.delay(2000);
						} catch (error) {
							console.error(
								`  ❌ Error buscando ${outboundDate} → ${inboundDate}:`,
								error.message
							);
						}
					}
				}
			} else {
				// Solo ida - buscar cada fecha de salida
				for (const outboundDate of searchDates.outbound) {
					try {
						console.log(`  🔍 Buscando solo ida: ${outboundDate}`);

						const searchParams = {
							origin: routeMonitor.origin,
							destination: routeMonitor.destination,
							departureDate: outboundDate,
							passengers: routeMonitor.passengers,
						};

						const rawData = await this.kiwiService.searchFlights(searchParams);
						const flights = this.kiwiService.parseFlightData(
							rawData,
							searchParams
						);

						if (flights && flights.length > 0) {
							allFlights.push(...flights);

							const cheapestFlight = flights.reduce((min, flight) =>
								flight.price.amount < min.price.amount ? flight : min
							);

							if (
								!bestPrice ||
								cheapestFlight.price.amount < bestPrice.price.amount
							) {
								bestPrice = cheapestFlight;
							}
						}

						// Pequeño delay entre fechas
						await this.delay(2000);
					} catch (error) {
						console.error(
							`  ❌ Error buscando fecha ${outboundDate}:`,
							error.message
						);
					}
				}
			}

			if (allFlights.length > 0) {
				await this.saveFlights(allFlights);
			}

			// Actualizar estadísticas con validación
			if (allFlights.length > 0) {
				// Extraer solo los precios válidos
				const validPrices = allFlights
					.map((f) => f.price)
					.filter((price) => {
						return (
							price &&
							!isNaN(price.amount) &&
							isFinite(price.amount) &&
							price.amount > 0 &&
							price.amount < 10000
						);
					});

				console.log(`📊 Precios válidos encontrados: ${validPrices.length}`);

				if (validPrices.length > 0) {
					routeMonitor.updateStats(validPrices);
				} else {
					console.log('📊 No hay precios válidos para actualizar stats');
					routeMonitor.stats.totalChecks += 1;
				}
			} else {
				console.log('📊 No se encontraron vuelos');
				routeMonitor.stats.totalChecks += 1;
			}

			// Verificar si debe enviar alerta
			if (bestPrice && (await routeMonitor.shouldAlert(bestPrice))) {
				const alertSent = await this.sendPriceAlert(
					bestPrice,
					routeMonitor,
					user
				);

				if (alertSent) {
					// Actualizar mejor precio si es menor
					if (
						!routeMonitor.bestPrice ||
						bestPrice.price.amount < routeMonitor.bestPrice.amount
					) {
						routeMonitor.bestPrice = {
							amount: bestPrice.price.amount,
							currency: bestPrice.price.currency,
							flightId: bestPrice.id,
							foundAt: new Date(),
						};
					}

					routeMonitor.notifications.telegram.lastSent = new Date();
					routeMonitor.stats.alertsSent++;
					this.stats.alertsToday++;
				}
			}

			// Guardar con manejo de errores
			try {
				await routeMonitor.save();
			} catch (saveError) {
				console.error(`❌ Error guardando monitor:`, saveError.message);

				// Si el error es por stats inválidos, resetear y volver a intentar
				if (
					saveError.message.includes('averagePrice') ||
					saveError.message.includes('NaN')
				) {
					console.log('🔧 Reseteando stats corruptos...');
					routeMonitor.stats.averagePrice = undefined;
					routeMonitor.stats.lowestPrice = undefined;
					routeMonitor.stats.highestPrice = undefined;

					try {
						await routeMonitor.save();
						console.log('✅ Monitor guardado después de resetear stats');
					} catch (retryError) {
						console.error(
							`❌ Error después de resetear stats:`,
							retryError.message
						);
						throw retryError;
					}
				} else {
					throw saveError;
				}
			}

			const resultMsg = bestPrice
				? `€${bestPrice.price.amount} ${bestPrice.price.amount <= routeMonitor.priceThreshold ? '🔥' : ''}`
				: 'No se encontraron vuelos';

			console.log(
				`  ✅ ${routeMonitor.name}: ${resultMsg} (${allFlights.length} vuelos encontrados)`
			);
		} catch (error) {
			console.error(`❌ Error en checkRoute para ${routeMonitor.name}:`, error);
			throw error;
		}
	}

	async saveFlights(flights) {
		let savedCount = 0;

		for (const flightData of flights) {
			try {
				const flight = new Flight(flightData);
				await flight.save();
				savedCount++;
			} catch (error) {
				if (error.code !== 11000) {
					console.error('Error guardando vuelo:', error.message);
				}
			}
		}

		if (savedCount > 0) {
			console.log(`  💾 Guardados ${savedCount} vuelos nuevos`);
		}
	}

	// Ahora pasa el usuario al servicio de Telegram
	async sendPriceAlert(flight, routeMonitor, user) {
		try {
			const success = await this.telegramService.sendPriceAlert(
				flight,
				routeMonitor,
				user
			);

			if (success) {
				console.log(
					`  📱 Alerta enviada a ${user.firstName}: €${flight.price.amount}`
				);
			} else {
				console.log(`  ❌ No se pudo enviar alerta a ${user.firstName}`);
			}

			return success;
		} catch (error) {
			console.error(`  ❌ Error enviando alerta:`, error.message);
			return false;
		}
	}

	async sendDailyReport() {
		try {
			const activeUsers = await User.countDocuments({isActive: true});
			const activeRoutes = await RouteMonitor.countDocuments({isActive: true});
			const todayFlights = await Flight.countDocuments({
				scrapedAt: {$gte: new Date(Date.now() - 24 * 60 * 60 * 1000)},
			});

			// Top usuarios más activos
			const topUsers = await User.find({isActive: true})
				.sort({'stats.alertsReceived': -1})
				.limit(3)
				.select('firstName stats.alertsReceived stats.activeMonitors');

			const stats = {
				activeUsers,
				activeRoutes,
				checksToday: this.stats.checksToday,
				alertsToday: this.stats.alertsToday,
				flightsFound: todayFlights,
				errorsToday: this.stats.errorsToday,
				topUsers,
			};

			await this.telegramService.sendMonitoringStatus(stats);
			console.log('📊 Reporte diario enviado');
		} catch (error) {
			console.error('❌ Error enviando reporte diario:', error);
		}
	}

	resetDailyStats() {
		this.stats.checksToday = 0;
		this.stats.alertsToday = 0;
		this.stats.errorsToday = 0;
	}

	delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	getStats() {
		return {
			...this.stats,
			isRunning: this.isRunning,
		};
	}
}

module.exports = MonitoringService;
