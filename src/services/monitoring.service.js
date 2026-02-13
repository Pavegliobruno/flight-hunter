const cron = require('node-cron');
const KiwiService = require('./kiwi.service');
const TelegramService = require('./telegram.service');
const RouteMonitor = require('../models/routeMonitor.models');
const Flight = require('../models/flight.model');

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

		// Reporte diario a las 9 AM + limpieza de DB
		cron.schedule(
			'0 9 * * *',
			async () => {
				await this.sendDailyReport();
				await this.cleanupOldFlights();
				await this.cleanupExpiredMonitors();
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

			// Obtener rutas activas que necesitan verificación
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
			});

			console.log(`📋 Rutas a verificar: ${routesToCheck.length}`);

			if (routesToCheck.length === 0) {
				console.log('✅ No hay rutas para verificar en este momento');
				return;
			}

			// Procesar cada ruta
			for (const route of routesToCheck) {
				try {
					await this.checkRoute(route);

					// Delay entre requests para no saturar la API
					await this.delay(5000); // 5 segundos entre cada consulta
				} catch (error) {
					console.error(
						`❌ Error verificando ruta ${route.name}:`,
						error.message
					);
					this.stats.errorsToday++;
				}
			}

			const duration = ((Date.now() - startTime) / 1000).toFixed(2);
			console.log(`✅ === FIN CICLO DE MONITOREO (${duration}s) ===\n`);

			this.stats.lastRun = new Date();
		} catch (error) {
			console.error('❌ Error en ciclo de monitoreo:', error);
			this.stats.errorsToday++;
		}
	}

	async checkRoute(routeMonitor) {
		try {
			console.log(
				`🔎 Verificando: ${routeMonitor.name} (${routeMonitor.origin} → ${routeMonitor.destination})`
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

							const rawData = await this.kiwiService.searchFlights(
								searchParams,
								routeMonitor
							);
							const flights = this.kiwiService.parseFlightData(
								rawData,
								searchParams,
								routeMonitor.currency || 'EUR'
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

						const rawData = await this.kiwiService.searchFlights(
							searchParams,
							routeMonitor
						);
						const flights = this.kiwiService.parseFlightData(
							rawData,
							searchParams,
							routeMonitor.currency || 'EUR'
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
					// Solo incrementar el contador de checks
					routeMonitor.stats.totalChecks += 1;
				}
			} else {
				console.log('📊 No se encontraron vuelos');
				// Solo incrementar el contador de checks
				routeMonitor.stats.totalChecks += 1;
			}

			// Fix 3: Actualizar bestPrice siempre que se encuentre un precio mejor
			if (
				bestPrice &&
				(!routeMonitor.bestPrice ||
					bestPrice.price.amount < routeMonitor.bestPrice.amount)
			) {
				routeMonitor.bestPrice = {
					amount: bestPrice.price.amount,
					currency: bestPrice.price.currency,
					flightId: bestPrice.id,
					foundAt: new Date(),
				};
			}

			// Fix 2: Intentar enviar alerta, si el más barato es duplicado probar el siguiente
			if (allFlights.length > 0) {
				const candidates = allFlights
					.filter((f) => routeMonitor.shouldAlert(f))
					.sort((a, b) => a.price.amount - b.price.amount);

				for (const flight of candidates) {
					const alertSent = await this.sendPriceAlert(flight, routeMonitor);
					if (alertSent) {
						routeMonitor.notifications.telegram.lastSent = new Date();
						routeMonitor.stats.alertsSent++;
						this.stats.alertsToday++;
						break;
					}
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

			const symbol = routeMonitor.currency === 'USD' ? '$' : '€';
			const resultMsg = bestPrice
				? `${symbol}${bestPrice.price.amount} ${bestPrice.price.amount <= routeMonitor.priceThreshold ? '🔥' : ''}`
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

	async sendPriceAlert(flight, routeMonitor) {
		try {
			const success = await this.telegramService.sendPriceAlert(
				flight,
				routeMonitor
			);

			if (success) {
				console.log(`  📱 Alerta enviada: €${flight.price.amount}`);
			} else {
				console.log(`  ❌ No se pudo enviar alerta`);
			}

			return success;
		} catch (error) {
			console.error(`  ❌ Error enviando alerta:`, error.message);
			return false;
		}
	}

	async sendDailyReport() {
		try {
			const User = require('../models/user.model');

			const activeRoutes = await RouteMonitor.countDocuments({isActive: true});
			const todayFlights = await Flight.countDocuments({
				scrapedAt: {$gte: new Date(Date.now() - 24 * 60 * 60 * 1000)},
			});

			// Estadísticas de usuarios
			const totalUsers = await User.countDocuments({status: 'active'});
			const pendingUsers = await User.countDocuments({status: 'pending'});

			// Usuarios únicos con alertas (monitores que enviaron alertas)
			const monitorsWithAlerts = await RouteMonitor.find({
				'stats.alertsSent': {$gt: 0},
			}).distinct('notifications.telegram.chatId');
			const usersWithAlerts = monitorsWithAlerts.length;

			// Total de alertas enviadas (suma de todos los monitores)
			const alertsAggregation = await RouteMonitor.aggregate([
				{$group: {_id: null, totalAlerts: {$sum: '$stats.alertsSent'}}},
			]);
			const totalAlertsSent = alertsAggregation[0]?.totalAlerts || 0;

			const stats = {
				activeRoutes,
				checksToday: this.stats.checksToday,
				alertsToday: this.stats.alertsToday,
				flightsFound: todayFlights,
				errorsToday: this.stats.errorsToday,
				totalUsers,
				pendingUsers,
				usersWithAlerts,
				totalAlertsSent,
			};

			await this.telegramService.sendMonitoringStatus(stats);
			console.log('📊 Reporte diario enviado');
		} catch (error) {
			console.error('❌ Error enviando reporte diario:', error);
		}
	}

	async cleanupOldFlights() {
		try {
			const twoDaysAgo = new Date();
			twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
			twoDaysAgo.setHours(0, 0, 0, 0);

			const result = await Flight.deleteMany({
				scrapedAt: {$lt: twoDaysAgo},
			});

			console.log(`🗑️ Vuelos eliminados: ${result.deletedCount}`);
		} catch (error) {
			console.error('Error en limpieza de vuelos antiguos:', error);
		}
	}

	async cleanupExpiredMonitors() {
		try {
			const today = new Date().toISOString().split('T')[0];

			const result = await RouteMonitor.deleteMany({
				'outboundDateRange.endDate': {$lt: today},
			});

			if (result.deletedCount > 0) {
				console.log(`🗑️ Monitores expirados eliminados: ${result.deletedCount}`);
			}
		} catch (error) {
			console.error('Error en limpieza de monitores expirados:', error);
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
