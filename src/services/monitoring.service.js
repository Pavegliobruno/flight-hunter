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

			// Generar fechas a buscar (si es flexible, busca varios días)
			const searchDates = this.generateSearchDates(routeMonitor.dateRange);

			let allFlights = [];
			let bestPrice = null;

			// Buscar vuelos para cada fecha
			// Buscar vuelos para cada fecha
			for (const date of searchDates) {
				try {
					// 🔧 FIX: Determinar si es ida y vuelta basado en el dateRange
					const isRoundTrip =
						routeMonitor.dateRange.startDate !== routeMonitor.dateRange.endDate;

					const searchParams = {
						origin: routeMonitor.origin,
						destination: routeMonitor.destination,
						departureDate: date,
						passengers: routeMonitor.passengers,
						// 🔧 FIX: Agregar returnDate si es ida y vuelta
						...(isRoundTrip && {returnDate: routeMonitor.dateRange.endDate}),
					};

					// 🔧 DEBUG: Mostrar qué parámetros se están enviando
					console.log(`  🔍 Buscando vuelos para ${date}:`, {
						origin: searchParams.origin,
						destination: searchParams.destination,
						departureDate: searchParams.departureDate,
						returnDate: searchParams.returnDate || 'SOLO IDA',
						passengers: searchParams.passengers,
					});

					const rawData = await this.kiwiService.searchFlights(searchParams);
					const flights = this.kiwiService.parseFlightData(
						rawData,
						searchParams
					);

					if (flights && flights.length > 0) {
						allFlights.push(...flights);

						// Encontrar el mejor precio
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
					console.error(`  ❌ Error buscando fecha ${date}:`, error.message);
				}
			}

			// Guardar vuelos en la DB
			if (allFlights.length > 0) {
				await this.saveFlights(allFlights);
			}

			// Actualizar estadísticas de la ruta
			const prices = allFlights.map((f) => f.price);
			routeMonitor.updateStats(prices);

			// Verificar si debe enviar alerta
			if (bestPrice && routeMonitor.shouldAlert(bestPrice)) {
				const alertSent = await this.sendPriceAlert(bestPrice, routeMonitor);

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

			// Guardar cambios en la ruta
			await routeMonitor.save();

			const resultMsg = bestPrice
				? `€${bestPrice.price.amount} ${bestPrice.price.amount <= routeMonitor.priceThreshold ? '🔥' : ''}`
				: 'No se encontraron vuelos';

			console.log(`  ✅ ${routeMonitor.name}: ${resultMsg}`);
		} catch (error) {
			console.error(`❌ Error en checkRoute para ${routeMonitor.name}:`, error);
			throw error;
		}
	}

	generateSearchDates(dateRange) {
		const dates = [];
		const start = new Date(dateRange.startDate);
		const end = new Date(dateRange.endDate);

		if (dateRange.flexible) {
			// Si es flexible, buscar algunas fechas específicas
			const diffTime = Math.abs(end - start);
			const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

			// Buscar máximo 5 fechas distribuidas en el rango
			const step = Math.max(1, Math.floor(diffDays / 5));

			for (let i = 0; i <= diffDays; i += step) {
				const date = new Date(start);
				date.setDate(start.getDate() + i);
				dates.push(date.toISOString().split('T')[0]);

				if (dates.length >= 5) break; // Máximo 5 fechas por request
			}
		} else {
			// Si no es flexible, solo la fecha específica
			dates.push(dateRange.startDate);
		}

		return dates;
	}

	async saveFlights(flights) {
		let savedCount = 0;

		for (const flightData of flights) {
			try {
				const flight = new Flight(flightData);
				await flight.save();
				savedCount++;
			} catch (error) {
				// Ignorar duplicados (error 11000)
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
			const activeRoutes = await RouteMonitor.countDocuments({isActive: true});
			const todayFlights = await Flight.countDocuments({
				scrapedAt: {$gte: new Date(Date.now() - 24 * 60 * 60 * 1000)},
			});

			const stats = {
				activeRoutes,
				checksToday: this.stats.checksToday,
				alertsToday: this.stats.alertsToday,
				flightsFound: todayFlights,
				errorsToday: this.stats.errorsToday,
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

	// Método para obtener estadísticas actuales
	getStats() {
		return {
			...this.stats,
			isRunning: this.isRunning,
		};
	}
}

module.exports = MonitoringService;
