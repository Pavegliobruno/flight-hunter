const axios = require('axios');
require('dotenv').config();

class KiwiService {
	constructor() {
		// URL correcta según lo que viste en DevTools
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
			// Headers críticos de Kiwi
			'kw-umbrella-token': process.env.KIWI_UMBRELLA_TOKEN,
			'kw-skypicker-visitor-uniqid': process.env.KIWI_VISITOR_UNIQID,
			'kw-x-rand-id': '09c9892f', // Header adicional que vi en tu request
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

			// Query GraphQL real de Kiwi obtenida del DevTools
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
        eligibilityInformation {
          baggageEligibilityInformation {
            topFiveResultsBaggageEligibleForPrompt
            numberOfBags
          }
          guaranteeAndRedirectsEligibilityInformation {
            redirect {
              anywhere
              top10
              isKiwiAvailable
            }
            guarantee {
              anywhere
              top10
            }
            combination {
              anywhere
              top10
            }
          }
          kiwiBasicEligibility {
            anywhere
            top10
          }
          topThreeResortingOccurred
          carriersDeeplinkEligibility
          responseContainsKayakItinerary
          paretoABTestEligible
        }
        carriers {
          code
          id
        }
        itinerariesCount
        hasMorePending
        missingProviders {
          code
        }
        searchFingerprint
        statusPerProvider {
          provider {
            id
          }
          errorHappened
          errorMessage
        }
        hasTier1MarketItineraries
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

			// Variables con códigos HARDCODEADOS temporalmente para Berlin-Istanbul
			const variables = {
				search: {
					itinerary: {
						source: {
							ids: [
								origin.toUpperCase() === 'BER'
									? 'City:berlin_de'
									: this.formatAirportCode(origin),
							],
						},
						destination: {
							ids: [
								destination.toUpperCase() === 'IST'
									? 'City:istanbul_tr'
									: this.formatAirportCode(destination),
							],
						},
						outboundDepartureDate: {
							start: `${departureDate}T00:00:00`,
							end: `${departureDate}T23:59:59`,
						},
						// Agregar inbound para búsquedas de ida y vuelta
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
				},
				conditions: false,
			};

			console.log(
				`🔍 Buscando vuelos: ${origin} → ${destination} (${departureDate})`
			);

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

	// Método para formatear códigos de aeropuerto/ciudad según formato de Kiwi
	formatAirportCode(code) {
		const cityMapping = {
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
			VIE: 'Airport:vienna_at',
			LIS: 'City:lisbon_pt',
			MXP: 'Airport:milan-malpensa_it',
			BER: 'City:berlin_de', // ✅ Berlin (todos los aeropuertos)

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

			// OTROS DESTINOS ASIÁTICOS POPULARES
			ICN: 'Airport:seoul-incheon_kr', // Seúl, Corea del Sur
			GMP: 'Airport:seoul-gimpo_kr', // Seúl Gimpo
			PVG: 'Airport:shanghai-pudong_cn', // Shanghai, China
			PEK: 'Airport:beijing-capital_cn', // Beijing, China
			HKG: 'Airport:hong-kong_hk', // Hong Kong
			SIN: 'Airport:singapore-changi_sg', // Singapur
			BKK: 'Airport:bangkok-suvarnabhumi_th', // Bangkok, Tailandia
			KUL: 'Airport:kuala-lumpur_my', // Kuala Lumpur, Malasia
			CGK: 'Airport:jakarta-soekarno-hatta_id', // Jakarta, Indonesia
			MNL: 'Airport:manila_ph', // Manila, Filipinas

			// OCEANÍA
			SYD: 'Airport:sydney-kingsford-smith_au', // Sydney, Australia
			MEL: 'Airport:melbourne_au', // Melbourne, Australia
			AKL: 'Airport:auckland_nz', // Auckland, Nueva Zelanda
		};

		const formatted = cityMapping[code.toUpperCase()];
		if (formatted) {
			console.log(`📍 Código ${code} → ${formatted}`);
			return formatted;
		}

		// Si no está en el mapeo, intentar formato genérico
		console.warn(`⚠️ Código ${code} no está mapeado, usando formato genérico`);
		return `City:${code.toLowerCase()}_ar`;
	}

	// Método para parsear la respuesta de Kiwi y convertirla a nuestro formato
	parseFlightData(rawData, searchQuery) {
		const flights = [];

		try {
			// Extraer itinerarios de la respuesta real de Kiwi
			const itineraries = rawData.returnItineraries?.itineraries || [];

			console.log(`📊 Parseando ${itineraries.length} itinerarios de Kiwi`);

			itineraries.forEach((itinerary) => {
				try {
					// Obtener el primer segmento outbound para datos básicos
					const outboundSegment =
						itinerary.outbound?.sectorSegments?.[0]?.segment;
					const inboundSegment =
						itinerary.inbound?.sectorSegments?.[0]?.segment;

					if (!outboundSegment) {
						console.warn('⚠️ Itinerario sin segmento outbound, saltando...');
						return;
					}

					// Obtener el mejor precio (EUR preferido)
					const priceEur = itinerary.priceEur?.amount;
					const priceOriginal = itinerary.price?.amount;

					// Obtener booking URL del primer booking option disponible
					const bookingUrl =
						itinerary.bookingOptions?.edges?.[0]?.node?.bookingUrl;

					const flight = {
						id: itinerary.id || itinerary.shareId,
						price: {
							amount: priceEur || priceOriginal,
							currency: priceEur ? 'EUR' : 'USD',
						},
						origin: {
							city: outboundSegment.source?.station?.city?.name,
							airport: outboundSegment.source?.station?.name,
							code: outboundSegment.source?.station?.code,
						},
						destination: {
							city: outboundSegment.destination?.station?.city?.name,
							airport: outboundSegment.destination?.station?.name,
							code: outboundSegment.destination?.station?.code,
						},
						departure: {
							date: new Date(outboundSegment.source?.utcTimeIso),
							time: outboundSegment.source?.localTime,
							timestamp: new Date(outboundSegment.source?.utcTimeIso).getTime(),
						},
						arrival: {
							date: new Date(outboundSegment.destination?.utcTimeIso),
							time: outboundSegment.destination?.localTime,
							timestamp: new Date(
								outboundSegment.destination?.utcTimeIso
							).getTime(),
						},
						duration: {
							total: this.formatDuration(itinerary.duration),
							minutes: itinerary.duration,
						},
						airline: {
							name: outboundSegment.carrier?.name,
							code: outboundSegment.carrier?.code,
							logo: null,
						},
						stops: this.extractStops(itinerary.outbound?.sectorSegments || []),
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
									date: new Date(inboundSegment.destination?.utcTimeIso),
									time: inboundSegment.destination?.localTime,
								},
								airline: {
									name: inboundSegment.carrier?.name,
									code: inboundSegment.carrier?.code,
								},
							},
						}),

						searchQuery,
						rawData: itinerary,
					};

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

	// Extraer escalas/stops del vuelo
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
		if (!minutes) return '';
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return `${hours}h ${mins}m`;
	}
}

module.exports = KiwiService;
