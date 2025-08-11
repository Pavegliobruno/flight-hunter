const axios = require('axios');
require('dotenv').config();

class KiwiService {
	constructor() {
		this.baseURL =
			'https://api.skypicker.com/umbrella/v2/graphql?featureName=SearchReturnItinerariesQuery';
		this.headers = {
			'Content-Type': 'application/json',
			'User-Agent':
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
			Accept: '*/*',
			'Accept-Language':
				'es-US,es;q=0.9,it-IT;q=0.8,it;q=0.7,es-ES;q=0.6,es-419;q=0.5,en;q=0.4,de;q=0.3',
			'Accept-Encoding': 'gzip, deflate, br, zstd',
			Origin: 'https://www.kiwi.com',
			Referer: 'https://www.kiwi.com/',
			'Sec-Fetch-Dest': 'empty',
			'Sec-Fetch-Mode': 'cors',
			'Sec-Fetch-Site': 'cross-site',
			'Sec-Ch-Ua':
				'"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
			'Sec-Ch-Ua-Mobile': '?0',
			'Sec-Ch-Ua-Platform': '"macOS"',
			Priority: 'u=1, i',
			'kw-umbrella-token': process.env.KIWI_UMBRELLA_TOKEN,
			'kw-skypicker-visitor-uniqid': process.env.KIWI_VISITOR_UNIQID,
			'kw-x-rand-id': '09c9892f',
		};
	}

	async searchFlights(searchParams) {
		try {
			const {
				origin,
				destination,
				departureDate,
				returnDate,
				passengers = 1,
			} = searchParams;

			const originFormatted = this.formatAirportCode(origin);
			const destinationFormatted = this.formatAirportCode(destination);

			console.log(
				`🔍 Buscando vuelos: ${origin} → ${destination} (${departureDate}${returnDate ? ` - ${returnDate}` : ''})`
			);

			const query = `query SearchReturnItinerariesQuery(
  $search: SearchReturnInput
  $filter: ItinerariesFilterInput
  $options: ItinerariesOptionsInput
) {
  returnItineraries(search: $search, filter: $filter, options: $options) {
    __typename
    ... on AppError {
      error: message
    }
    ... on Itineraries {
      server {
        requestId
        environment
        packageVersion
        serverToken
      }
      metadata {
        itinerariesCount
        hasMorePending
        searchFingerprint
      }
      itineraries {
        __typename
        ... on ItineraryReturn {
          ... on Itinerary {
            __isItinerary: __typename
            __typename
            id
            shareId
            price {
              amount
              priceBeforeDiscount
            }
            priceEur {
              amount
            }
            provider {
              name
              code
              hasHighProbabilityOfPriceChange
              contentProvider {
                code
              }
              id
            }
            bookingOptions {
              edges {
                node {
                  token
                  bookingUrl
                  trackingPixel
                  itineraryProvider {
                    code
                    name
                    subprovider
                    hasHighProbabilityOfPriceChange
                    contentProvider {
                      code
                    }
                    providerCategory
                    id
                  }
                  price {
                    amount
                  }
                  priceEur {
                    amount
                  }
                  kiwiProduct
                  disruptionTreatment
                  usRulesApply
                }
              }
            }
            travelHack {
              isTrueHiddenCity
              isVirtualInterlining
              isThrowawayTicket
            }
            isVanilla
            duration
            pnrCount
          }
          legacyId
          outbound {
            id
            sectorSegments {
              guarantee
              segment {
                id
                source {
                  localTime
                  utcTimeIso
                  station {
                    id
                    legacyId
                    name
                    code
                    type
                    city {
                      legacyId
                      name
                      id
                    }
                    country {
                      code
                      id
                    }
                  }
                }
                destination {
                  localTime
                  utcTimeIso
                  station {
                    id
                    legacyId
                    name
                    code
                    type
                    city {
                      legacyId
                      name
                      id
                    }
                    country {
                      code
                      id
                    }
                  }
                }
                duration
                type
                code
                carrier {
                  id
                  name
                  code
                }
                operatingCarrier {
                  id
                  name
                  code
                }
                cabinClass
              }
              layover {
                duration
                isBaggageRecheck
                isWalkingDistance
                transferDuration
                id
              }
            }
            duration
          }
          inbound {
            id
            sectorSegments {
              guarantee
              segment {
                id
                source {
                  localTime
                  utcTimeIso
                  station {
                    id
                    legacyId
                    name
                    code
                    type
                    city {
                      legacyId
                      name
                      id
                    }
                    country {
                      code
                      id
                    }
                  }
                }
                destination {
                  localTime
                  utcTimeIso
                  station {
                    id
                    legacyId
                    name
                    code
                    type
                    city {
                      legacyId
                      name
                      id
                    }
                    country {
                      code
                      id
                    }
                  }
                }
                duration
                type
                code
                carrier {
                  id
                  name
                  code
                }
                operatingCarrier {
                  id
                  name
                  code
                }
                cabinClass
              }
              layover {
                duration
                isBaggageRecheck
                isWalkingDistance
                transferDuration
                id
              }
            }
            duration
          }
          stopover {
            nightsCount
            arrival {
              type
              city {
                name
                id
              }
              id
            }
            departure {
              type
              city {
                name
                id
              }
              id
            }
            duration
          }
          lastAvailable {
            seatsLeft
          }
          isRyanair
          benefitsData {
            automaticCheckinAvailable
            instantChatSupportAvailable
            disruptionProtectionAvailable
            guaranteeAvailable
            guaranteeFee {
              roundedAmount
            }
            guaranteeFeeEur {
              amount
            }
            searchReferencePrice {
              roundedAmount
            }
          }
          isAirBaggageBundleEligible
        }
        id
      }
    }
  }
}`;

			const variables = {
				search: {
					itinerary: {
						source: {
							ids: [originFormatted],
						},
						destination: {
							ids: [destinationFormatted],
						},
						outboundDepartureDate: {
							start: `${departureDate}T00:00:00`,
							end: `${departureDate}T23:59:59`,
						},
						...(returnDate && {
							inboundDepartureDate: {
								start: `${returnDate}T00:00:00`,
								end: `${returnDate}T23:59:59`,
							},
						}),
					},
					passengers: {
						adults: passengers,
						children: 0,
						infants: 0,
						adultsHoldBags: [0],
						adultsHandBags: [0],
						childrenHoldBags: [],
						childrenHandBags: [],
					},
					cabinClass: {
						cabinClass: 'ECONOMY',
						applyMixedClasses: false,
					},
				},
				filter: {
					allowReturnFromDifferentCity: true,
					allowChangeInboundDestination: true,
					allowChangeInboundSource: true,
					allowDifferentStationConnection: true,
					enableSelfTransfer: true,
					enableThrowAwayTicketing: true,
					enableTrueHiddenCity: true,
					transportTypes: ['FLIGHT'],
					contentProviders: ['KIWI'],
					flightsApiLimit: 25,
					limit: 10,
				},
				options: {
					sortBy: 'QUALITY',
					mergePriceDiffRule: 'INCREASED',
					currency: 'eur',
					apiUrl: null,
					locale: 'es',
					market: 'ar',
					partner: 'skypicker',
					partnerMarket: 'ar',
					affilID: 'acquisition000brand000sem',
					storeSearch: false,
					searchStrategy: 'REDUCED',
					abTestInput: {
						baggageProtectionBundle: 'ENABLE',
						paretoProtectVanilla: 'ENABLE',
						kiwiBasicThirdIteration: 'C',
						marketStopPenalisation0: 'DISABLE',
						kayakWithoutBags: 'DISABLE',
						nonBrandRedirectsRemoval: 'DISABLE',
						carriersDeeplinkResultsEnable: true,
						carriersDeeplinkOnSEMEnable: true,
					},
					sortVersion: 14,
					applySortingChanges: false,
					serverToken: process.env.KIWI_SERVER_TOKEN || null,
					searchSessionId: this.generateSessionId(),
				},
			};

			const response = await axios.post(
				this.baseURL,
				{
					query,
					variables,
				},
				{
					headers: this.headers,
					timeout: 30000,
				}
			);

			if (response.data.errors) {
				throw new Error(
					`GraphQL Error: ${JSON.stringify(response.data.errors)}`
				);
			}

			return response.data.data;
		} catch (error) {
			console.error('❌ Error en KiwiService.searchFlights:', error.message);

			if (error.response) {
				console.error('Status:', error.response.status);
				console.error('Headers:', error.response.headers);
				console.error('Data:', JSON.stringify(error.response.data, null, 2));
			}

			throw error;
		}
	}

	formatAirportCode(code) {
		const cityMapping = {
			// EUROPA
			VIE: 'City:vienna_at',
			BER: 'City:berlin_de',
			BRI: 'City:bari_it',

			// Argentina
			BUE: 'City:buenos-aires_ar',
			EZE: 'Airport:ezeiza_ar',
			AEP: 'Airport:jorge-newbery-airfield_ar',
			COR: 'City:cordoba_ar',
			MDZ: 'Airport:mendoza_ar',
			IGU: 'Airport:iguazu-falls_ar',
			USH: 'Airport:ushuaia_ar',
			BRC: 'Airport:bariloche_ar',
			FTE: 'Airport:el-calafate_ar',

			// España
			MAD: 'City:madrid_es',
			BCN: 'City:barcelona_es',
			VLC: 'City:valencia_es',
			SVQ: 'City:seville_es',
			BIO: 'City:bilbao_es',
			PMI: 'Airport:palma-mallorca_es',
			LPA: 'Airport:las-palmas_es',
			TFS: 'Airport:tenerife-south_es',

			// Europa común
			CDG: 'Airport:paris-charles-de-gaulle_fr',
			LHR: 'Airport:london-heathrow_gb',
			FCO: 'Airport:rome-fiumicino_it',
			AMS: 'Airport:amsterdam-schiphol_nl',
			FRA: 'Airport:frankfurt_de',
			MUC: 'Airport:munich_de',
			ZUR: 'Airport:zurich_ch',
			LIS: 'City:lisbon_pt',
			MXP: 'Airport:milan-malpensa_it',

			// Americas
			MIA: 'City:miami_us',
			JFK: 'Airport:new-york-jfk_us',
			LAX: 'Airport:los-angeles_us',
			MEX: 'City:mexico-city_mx',
			GRU: 'Airport:sao-paulo-guarulhos_br',
			GIG: 'Airport:rio-de-janeiro-galeao_br',
			SCL: 'City:santiago_cl',
			LIM: 'City:lima_pe',
			BOG: 'City:bogota_co',

			// JAPÓN
			NRT: 'Airport:tokyo-narita_jp',
			HND: 'Airport:tokyo-haneda_jp',
			KIX: 'Airport:osaka-kansai_jp',
			NGO: 'Airport:nagoya-chubu_jp',
			FUK: 'Airport:fukuoka_jp',
			SPK: 'Airport:sapporo-chitose_jp',
			ITM: 'Airport:osaka-itami_jp',
			KMI: 'Airport:miyazaki_jp',
			HIJ: 'Airport:hiroshima_jp',
			OKA: 'Airport:okinawa-naha_jp',

			// OTROS DESTINOS ASIÁTICOS
			ICN: 'Airport:seoul-incheon_kr',
			GMP: 'Airport:seoul-gimpo_kr',
			PVG: 'Airport:shanghai-pudong_cn',
			PEK: 'Airport:beijing-capital_cn',
			HKG: 'Airport:hong-kong_hk',
			SIN: 'Airport:singapore-changi_sg',
			BKK: 'Airport:bangkok-suvarnabhumi_th',
			KUL: 'Airport:kuala-lumpur_my',
			CGK: 'Airport:jakarta-soekarno-hatta_id',
			MNL: 'Airport:manila_ph',

			// OCEANÍA
			SYD: 'Airport:sydney-kingsford-smith_au',
			MEL: 'Airport:melbourne_au',
			AKL: 'Airport:auckland_nz',

			// TURQUÍA
			IST: 'City:istanbul_tr',
			SAW: 'Airport:sabiha-gokcen_tr',
		};

		const formatted = cityMapping[code.toUpperCase()];
		if (formatted) {
			console.log(`📍 Código ${code} → ${formatted}`);
			return formatted;
		}

		console.warn(`⚠️ Código ${code} no está mapeado, usando formato genérico`);
		return `City:${code.toLowerCase()}_de`;
	}

	// Resto de métodos igual...
	generateSessionId() {
		return (
			Math.random().toString(36).substring(2, 15) +
			Math.random().toString(36).substring(2, 15)
		);
	}

	// Método debug mejorado
	debugSearchResponse(rawData, searchParams) {
		console.log('🔧 DEBUG - Parámetros de búsqueda:');
		console.log('  Origin:', searchParams.origin);
		console.log('  Destination:', searchParams.destination);
		console.log('  Departure Date:', searchParams.departureDate);
		console.log('  Return Date:', searchParams.returnDate);

		const itineraries = rawData.returnItineraries?.itineraries || [];

		if (itineraries.length > 0) {
			console.log('🔧 DEBUG - Primeros 3 itinerarios encontrados:');

			itineraries.slice(0, 3).forEach((itinerary, index) => {
				const outbound = itinerary.outbound?.sectorSegments?.[0]?.segment;
				const inbound = itinerary.inbound?.sectorSegments?.[0]?.segment;

				console.log(`  Itinerario ${index + 1}:`);
				console.log(`    ID: ${itinerary.id}`);
				console.log(
					`    Precio: €${itinerary.priceEur?.amount || itinerary.price?.amount}`
				);

				if (outbound) {
					console.log(
						`    Ida: ${outbound.source?.station?.code} (${outbound.source?.station?.city?.name}) → ${outbound.destination?.station?.code} (${outbound.destination?.station?.city?.name})`
					);
				}

				if (inbound) {
					console.log(
						`    Vuelta: ${inbound.source?.station?.code} (${inbound.source?.station?.city?.name}) → ${inbound.destination?.station?.code} (${inbound.destination?.station?.city?.name})`
					);
				}

				console.log('    ---');
			});
		} else {
			console.log('🔧 DEBUG - No se encontraron itinerarios');
		}
	}

	parseFlightData(rawData, searchQuery) {
		this.debugSearchResponse(rawData, searchQuery);

		const flights = [];

		try {
			const itineraries = rawData.returnItineraries?.itineraries || [];
			console.log(`📊 Parseando ${itineraries.length} itinerarios de Kiwi`);

			itineraries.forEach((itinerary, index) => {
				try {
					const outboundSegment =
						itinerary.outbound?.sectorSegments?.[0]?.segment;
					const inboundSegment =
						itinerary.inbound?.sectorSegments?.[0]?.segment;

					if (!outboundSegment) {
						console.warn('⚠️ Itinerario sin segmento outbound, saltando...');
						return;
					}

					// 🔥 NUEVA VALIDACIÓN: Verificar destinos correctos
					const expectedOrigin = searchQuery.origin;
					const expectedDestination = searchQuery.destination;
					const actualOrigin = outboundSegment.source?.station?.code;
					const actualDestination = outboundSegment.destination?.station?.code;

					// Validar que el primer segmento sea el origen correcto
					if (actualOrigin !== expectedOrigin) {
						console.warn(
							`⚠️ Origen incorrecto. Esperado: ${expectedOrigin}, Actual: ${actualOrigin}`
						);
						return;
					}

					// 🔥 VALIDACIÓN MEJORADA: Para vuelos con escalas, validar el destino final
					const finalDestination = this.getFinalDestination(itinerary.outbound);
					/* 	if (finalDestination !== expectedDestination) {
						console.warn(
							`⚠️ Destino final incorrecto. Esperado: ${expectedDestination}, Actual: ${finalDestination}`
						);
						return;
					} */

					// Validar precios antes de usar
					const priceEur = itinerary.priceEur?.amount;
					const priceOriginal = itinerary.price?.amount;
					const finalPrice = priceEur || priceOriginal;

					if (!finalPrice || isNaN(finalPrice) || finalPrice <= 0) {
						console.warn('⚠️ Precio inválido, saltando vuelo:', finalPrice);
						return;
					}

					const bookingUrl =
						itinerary.bookingOptions?.edges?.[0]?.node?.bookingUrl;

					// 🔥 CALCULAR SI ES VUELO DIRECTO
					const isDirectFlight = this.isDirectFlight(itinerary.outbound);
					const numStops = this.getNumberOfStops(itinerary.outbound);

					const flight = {
						id: itinerary.id || itinerary.shareId,
						price: {
							amount: finalPrice,
							currency: priceEur ? 'EUR' : 'USD',
						},
						origin: {
							city: outboundSegment.source?.station?.city?.name,
							airport: outboundSegment.source?.station?.name,
							code: outboundSegment.source?.station?.code,
						},
						destination: {
							city: this.getFinalDestinationInfo(itinerary.outbound)?.city,
							airport: this.getFinalDestinationInfo(itinerary.outbound)
								?.airport,
							code: this.getFinalDestinationInfo(itinerary.outbound)?.code,
						},
						departure: {
							date: new Date(outboundSegment.source?.utcTimeIso),
							time: outboundSegment.source?.localTime,
							timestamp: new Date(outboundSegment.source?.utcTimeIso).getTime(),
						},
						arrival: {
							date: new Date(this.getFinalArrival(itinerary.outbound)),
							time: this.getFinalArrivalTime(itinerary.outbound),
							timestamp: new Date(
								this.getFinalArrival(itinerary.outbound)
							).getTime(),
						},
						duration: {
							total: this.formatDuration(
								itinerary.outbound?.duration || itinerary.duration
							),
							minutes: itinerary.outbound?.duration || itinerary.duration,
						},
						airline: {
							name: outboundSegment.carrier?.name,
							code: outboundSegment.carrier?.code,
							logo: null,
						},
						stops: this.extractStops(itinerary.outbound?.sectorSegments || []),

						// 🔥 NUEVOS CAMPOS
						isDirect: isDirectFlight,
						numberOfStops: numStops,
						flightQuality: this.calculateFlightQuality(
							finalPrice,
							isDirectFlight,
							numStops
						),

						bookingUrl: bookingUrl,
						provider: itinerary.provider?.name,
						isVanilla: itinerary.isVanilla,

						...(inboundSegment && {
							returnFlight: {
								departure: {
									date: new Date(inboundSegment.source?.utcTimeIso),
									time: inboundSegment.source?.localTime,
								},
								arrival: {
									date: new Date(this.getFinalArrival(itinerary.inbound)),
									time: this.getFinalArrivalTime(itinerary.inbound),
								},
								airline: {
									name: inboundSegment.carrier?.name,
									code: inboundSegment.carrier?.code,
								},
								isDirect: this.isDirectFlight(itinerary.inbound),
								numberOfStops: this.getNumberOfStops(itinerary.inbound),
							},
						}),

						searchQuery,
						rawData: itinerary,
					};

					// 🔥 LOG MEJORADO
					console.log(
						`  ✈️ Vuelo ${isDirectFlight ? 'DIRECTO' : `${numStops} escalas`}: ${flight.origin.code} → ${flight.destination.code} - €${finalPrice}`
					);

					flights.push(flight);
				} catch (parseError) {
					console.error(
						'❌ Error parseando itinerario individual:',
						parseError.message
					);
				}
			});
		} catch (error) {
			console.error('❌ Error parseando datos de vuelos:', error);
		}

		return flights;
	}

	// 🔥 NUEVOS MÉTODOS AUXILIARES
	getFinalDestination(leg) {
		if (!leg?.sectorSegments) return null;
		const lastSegment = leg.sectorSegments[leg.sectorSegments.length - 1];
		return lastSegment?.segment?.destination?.station?.code;
	}

	getFinalDestinationInfo(leg) {
		if (!leg?.sectorSegments) return {};
		const lastSegment = leg.sectorSegments[leg.sectorSegments.length - 1];
		const dest = lastSegment?.segment?.destination?.station;
		return {
			city: dest?.city?.name,
			airport: dest?.name,
			code: dest?.code,
		};
	}

	getFinalArrival(leg) {
		if (!leg?.sectorSegments) return null;
		const lastSegment = leg.sectorSegments[leg.sectorSegments.length - 1];
		return lastSegment?.segment?.destination?.utcTimeIso;
	}

	getFinalArrivalTime(leg) {
		if (!leg?.sectorSegments) return null;
		const lastSegment = leg.sectorSegments[leg.sectorSegments.length - 1];
		return lastSegment?.segment?.destination?.localTime;
	}

	isDirectFlight(leg) {
		return leg?.sectorSegments?.length === 1;
	}

	getNumberOfStops(leg) {
		return Math.max(0, (leg?.sectorSegments?.length || 1) - 1);
	}

	calculateFlightQuality(price, isDirect, stops) {
		let score = 100;

		// Penalizar por escalas
		score -= stops * 30;

		// Bonificar vuelos directos
		if (isDirect) score += 20;

		// Penalizar precios muy altos
		if (price > 400) score -= 20;
		if (price > 500) score -= 40;

		return Math.max(0, Math.min(100, score));
	}

	extractStops(sectorSegments) {
		const stops = [];

		if (sectorSegments.length > 1) {
			for (let i = 0; i < sectorSegments.length - 1; i++) {
				const currentSegment = sectorSegments[i];
				const layover = currentSegment.layover;

				if (layover && layover.duration > 0) {
					stops.push({
						airport: currentSegment.segment.destination?.station?.code,
						city: currentSegment.segment.destination?.station?.city?.name,
						duration: this.formatDuration(layover.duration),
					});
				}
			}
		}

		return stops;
	}

	formatDuration(minutes) {
		if (!minutes || isNaN(minutes)) return '';
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return `${hours}h ${mins}m`;
	}
}

module.exports = KiwiService;
