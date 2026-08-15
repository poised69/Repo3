/**
 * The town's ten buildings and how each one maps onto the real pipeline.
 *
 * Every scenario id, module id and callback string in this file was read out of
 * the live Make blueprints via the Make API on 2026-08-15. Nothing here is
 * inferred from route names or route ordering. If you change a scenario in
 * Make, re-verify against the blueprint rather than editing from memory.
 */

/** Buildings, in pipeline order (left to right in the reference artwork). */
export const BUILDINGS = [
  { id: 'market_research', name: 'Market Research', blurb: 'Pulling Etsy competition and demand numbers' },
  { id: 'ideation_lab', name: 'Ideation Lab', blurb: 'Pairing interests into candidate niches' },
  { id: 'scoring_office', name: 'Scoring Office', blurb: 'Three-pass scoring of candidate niches' },
  { id: 'design_studio', name: 'Design Studio', blurb: 'Generating and critiquing design concepts' },
  { id: 'image_foundry', name: 'Image Foundry', blurb: 'Generating artwork (this one spends real money)' },
  { id: 'review_house', name: 'Review House', blurb: 'Revising the concept on your instructions' },
  { id: 'print_fulfillment', name: 'Print & Fulfillment', blurb: 'Creating the Printify product and mockups' },
  { id: 'etsy_storefront', name: 'Etsy Storefront', blurb: 'Syncing and configuring the Etsy listing' },
  { id: 'listing_check', name: 'Listing Check Booth', blurb: 'Reading the real state of a live listing' },
  { id: 'ops_tower', name: 'Ops Control Tower', blurb: 'Checking pipeline health and sending the digest' },
];

export const BUILDING_IDS = BUILDINGS.map((b) => b.id);

/**
 * The three scenarios that map 1:1 onto a single building. Confirmed 1:1 - no
 * other scenario feeds these buildings and none of them feeds more than one.
 */
export const LINEAR_SCENARIOS = [
  {
    scenarioId: 6945454,
    name: 'POD - Niche Data Refresh (weekly)',
    building: 'market_research',
    schedule: 'Mon 08:00 Asia/Seoul',
  },
  {
    scenarioId: 6889547,
    name: 'POD - Etsy Live Listing Verifier',
    building: 'listing_check',
    schedule: 'on-demand (manual trigger only)',
  },
  {
    scenarioId: 6868468,
    name: 'POD - Operational Health & Weekly Digest',
    building: 'ops_tower',
    schedule: 'Sun 19:00 Asia/Seoul',
  },
];

/** BBW: one webhook-triggered scenario whose router fans out to 7 buildings. */
export const BBW_SCENARIO_ID = 6783491;

/**
 * Router module 6 ("M1b - Route by Callback") gates each route on
 * {{2.callback_query.data}} - i.e. which inline-keyboard button was tapped.
 * Keys below are those exact filter values.
 *
 * Route 2 (entry module 8) carries NO filter and is an inert
 * `placeholder:Placeholder` stub - an orphaned route. It is deliberately absent
 * from this map: it must not light any building.
 */
export const CALLBACK_TO_BUILDING = {
  generate_batch: 'ideation_lab', // route0, entry module 7
  score_niches: 'scoring_office', // route1, entry module 100
  generate_brief: 'design_studio', // route3, entry module 500
  generate_images: 'image_foundry', // route4, entry module 560
  review_proceed: 'print_fulfillment', // route5, entry 610 - two-phase, see below
  review_change: 'review_house', // route6,  entry module 640
  review_polish: 'review_house', // route7,  entry module 620
  review_reevaluate: 'review_house', // route8,  entry module 630
  polish_bigger_text: 'review_house', // route9,  entry module 701
  polish_color: 'review_house', // route10, entry module 704
  polish_simplify: 'review_house', // route11, entry module 707
};

/** The single callback that drives two buildings in sequence. */
export const TWO_PHASE_CALLBACK = 'review_proceed';

/**
 * `review_proceed` is ONE continuous execution (~4-5 min observed) that walks
 * through Print & Fulfillment work and then Etsy work. Make's API exposes
 * execution-level state only - there is no per-module live detail - so we
 * cannot read which module is currently running.
 *
 * This is therefore a HEURISTIC, but a grounded one: the cutover below is
 * derived from the actual sleeps in the live blueprint rather than guessed.
 *
 *   610/611/605/815  confirm + load config      ~1-2s
 *   850              LLM writes the Etsy copy   ~10-20s (variable)
 *   810              Printify createAProduct    ~2-5s
 *   811              util:FunctionSleep         90s   <- "Wait for Mockups"
 *   812/813          get mockups, publish       ~2-5s
 *   ------------------------------------------------- ~115s: Printify side done
 *   828              util:FunctionSleep         60s   <- "Wait for Etsy sync"
 *   829..863         read Etsy listing id (up to two further 60s retries)
 *   832..848         compliance fields, listing state, logging
 *
 * So: Print & Fulfillment for the first ~115 seconds, Etsy Storefront from then
 * until the execution actually ends. The END is not guessed - it comes from
 * Make's real EXECUTION_END event, so the animation stops when the run stops.
 */
export const PRINT_PHASE_MS = 115_000;
export const PHASE_SEQUENCE = ['print_fulfillment', 'etsy_storefront'];

/**
 * Fallback duration used only when we know a route fired (Telegram told us) but
 * Make has not yet reported a matching execution - or the token is absent, so
 * we have no execution to watch. Generous on purpose; a real EXECUTION_END
 * always overrides it.
 */
export const CALLBACK_ASSUMED_MS = {
  generate_batch: 60_000,
  score_niches: 90_000,
  generate_brief: 60_000,
  generate_images: 120_000,
  review_proceed: 300_000,
  review_change: 60_000,
  review_polish: 60_000,
  review_reevaluate: 60_000,
  polish_bigger_text: 120_000,
  polish_color: 120_000,
  polish_simplify: 120_000,
};

export const DEFAULT_ASSUMED_MS = 60_000;

/** Buildings that only BBW can drive - used for the degraded-mode indicator. */
export const BBW_BUILDINGS = [
  'ideation_lab',
  'scoring_office',
  'design_studio',
  'image_foundry',
  'review_house',
  'print_fulfillment',
  'etsy_storefront',
];

export function buildingById(id) {
  return BUILDINGS.find((b) => b.id === id) || null;
}
