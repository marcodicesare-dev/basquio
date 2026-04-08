import { FREE_TIER_CREDITS } from "@/lib/credits";
import {
  CREDIT_PACK_CATALOG,
  getCreditPackConfig,
  normalizePlanId,
  PLAN_CONFIG,
  type CreditPackId,
  type PackPricingTier,
  type PlanId,
} from "@/lib/billing-config";
import { createServiceSupabaseClient, fetchRestRows } from "@/lib/supabase/admin";

const DISCORD_CUSTOMERS_WEBHOOK_URL = process.env.DISCORD_CUSTOMERS_WEBHOOK_URL;
const BASQUIO_AVATAR_URL = "https://basquio.com/brand/png/icon/2x/basquio-icon-ultramarine@2x.png";
const CUSTOMERS_TIMEZONE = "Europe/Zurich";
const PERSONAL_EMAIL_DOMAINS = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com"]);
const CELEBRATION_GIFS = [
  "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExc2N4aDlnOWl5c25rM2JiZWU0cWJjMHdwN3FkeWR3dDY4bm9jM2FkbSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/lMameLIF8voLu8HxWV/giphy.gif",
  "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbnJ3dDg1aTl1djVxanJxeGZ6bmh3cXV4dDY5eHE2dXR1cTJwejltMCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/5GoVLqeAOo6PK/giphy.gif",
  "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdWUyMDY5MDRpd2V6dXM0eWF6OHNndWpqajF5eTF1MXl4ODd1b2x6NCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/111ebonMs90YLu/giphy.gif",
];

const COLOR = {
  BLURPLE: 0x5865F2,
  GREEN: 0x1DB954,
  EMERALD: 0x10B981,
  GOLD: 0xFFD700,
  ORANGE: 0xF97316,
  RED: 0xEF4444,
} as const;

const SIGNUP_FLAVOR_TEXT = [
  "Welcome to the machine.",
  "Another analyst freed from the reporting cycle.",
  "One more person who'll never copy-paste a chart by hand again.",
  "The rebellion grows.",
  "30 free credits. Let's see what they build.",
];

const GIULIA_SAMPIETRO_LINES = [
  "Giulia, fallo meglio di Francesca Sampietro.",
  "Reminder: Francesca Sampietro would never use Basquio. We're already winning.",
  "Giulia, this one's for you. Not for Francesca Sampietro.",
  "Another customer that could've gone to Francesca Sampietro but didn't.",
  "Somewhere, Francesca Sampietro is still making decks by hand.",
  "Giulia says this is better than anything Francesca Sampietro ever shipped.",
];

type DiscordField = {
  name: string;
  value: string;
  inline?: boolean;
};

type DiscordEmbed = {
  title: string;
  description: string;
  color: number;
  fields?: DiscordField[];
  footer?: { text: string };
  timestamp?: string;
  image?: { url: string };
};

type DiscordWebhookPayload = {
  username: string;
  avatar_url: string;
  content?: string;
  embeds: DiscordEmbed[];
  allowed_mentions?: { parse: string[] };
};

type RuntimeConfig = {
  supabaseUrl: string;
  serviceKey: string;
};

type SubscriptionRow = {
  user_id: string;
  plan: string;
  billing_interval: "monthly" | "annual";
  status: string;
};

type CreditGrantRow = {
  user_id: string;
  source: string;
};

type SignupRow = {
  user_id: string;
};

type RevenueSnapshot = {
  payerUserIds: Set<string>;
  currentUserRevenueEvents: number;
  activeSubscriptionCount: number;
  currentMrr: number;
};

type SignupInput = {
  email: string;
  sourceLabel?: string | null;
};

type CreditPurchaseInput = {
  email: string;
  packId: CreditPackId;
  pricingTier?: PackPricingTier | null;
};

type SubscriptionStartedInput = {
  email: string;
  plan: string;
  interval: "monthly" | "annual";
  creditsIncluded: number;
  previousStatus?: string | null;
};

type PlanUpgradeInput = {
  email: string;
  fromPlan: string;
  toPlan: string;
  fromInterval: "monthly" | "annual";
  toInterval: "monthly" | "annual";
};

type RenewalInput = {
  email: string;
  plan: string;
  creditsGranted: number;
};

type PaymentFailedInput = {
  email: string;
  plan?: string | null;
};

type CancellationInput = {
  email: string;
  plan?: string | null;
};

export function isTestCustomerEmail(email: string): boolean {
  return email.toLowerCase().endsWith("@basquio.com");
}

export async function notifySignup(input: SignupInput): Promise<void> {
  if (!DISCORD_CUSTOMERS_WEBHOOK_URL) {
    return;
  }

  const email = input.email.trim();
  const fields: DiscordField[] = [
    { name: "Plan", value: "Free", inline: true },
    { name: "Credits", value: String(FREE_TIER_CREDITS), inline: true },
  ];

  if (input.sourceLabel) {
    fields.push({ name: "Source", value: input.sourceLabel, inline: false });
  }

  const embeds: DiscordEmbed[] = [
    createEmbed({
      title: "👤 New signup",
      description: `**${email}** joined Basquio`,
      color: COLOR.BLURPLE,
      fields,
    }),
  ];

  let content = "";
  if (!isTestCustomerEmail(email)) {
    content = buildContent([
      pickRandom(SIGNUP_FLAVOR_TEXT),
      getCompanyEasterEgg(email),
      getDomainIntelligence(email),
      getTimeBasedSignupEasterEgg(),
      getAleJapaneseLine(email),
      getSampietroAlert(email),
    ]);

    const milestone = await buildSignupMilestone(email).catch(() => null);
    if (milestone) {
      embeds.push(milestone);
    }
  }

  await postWebhook({ content, embeds });
}

export async function notifyCreditPurchase(input: CreditPurchaseInput): Promise<void> {
  if (!DISCORD_CUSTOMERS_WEBHOOK_URL) {
    return;
  }

  const email = input.email.trim();
  const packId = input.packId;
  const pack = CREDIT_PACK_CATALOG[packId];
  const pricingTier = normalizePricingTier(input.pricingTier);
  const packConfig = getCreditPackConfig(pricingTier, packId);
  const amountLabel = formatUsd(packConfig.price);
  const embeds: DiscordEmbed[] = [
    createEmbed({
      title: "💰 Credit pack purchased",
      description: `**${email}** bought **${pack.credits} credits**`,
      color: COLOR.GREEN,
      fields: [
        { name: "Pack", value: `${pack.credits} credits`, inline: true },
        { name: "Credits", value: String(pack.credits), inline: true },
      ],
    }),
  ];

  let content = "";
  if (!isTestCustomerEmail(email)) {
    content = buildContent([
      getCreditPackExtraLine(packId),
      getCompanyEasterEgg(email),
      getDomainIntelligence(email),
      getSampietroAlert(email),
    ]);

    const milestone = await buildFirstRevenueMilestone({
      email,
      amountLabel,
    }).catch(() => null);
    if (milestone) {
      embeds.push(milestone);
    }
  }

  await postWebhook({ content, embeds });
}

export async function notifySubscriptionStarted(input: SubscriptionStartedInput): Promise<void> {
  if (!DISCORD_CUSTOMERS_WEBHOOK_URL) {
    return;
  }

  const email = input.email.trim();
  const plan = normalizePlanId(input.plan);
  const interval = normalizeInterval(input.interval);
  const embeds: DiscordEmbed[] = [
    createEmbed({
      title: "💳 New subscription",
      description: `**${email}** subscribed to **${getPlanLabel(plan)}**`,
      color: COLOR.GREEN,
      fields: [
        { name: "Plan", value: getPlanLabel(plan), inline: true },
        { name: "Interval", value: getIntervalLabel(interval), inline: true },
        { name: "Credits", value: `${input.creditsIncluded}/mo`, inline: true },
      ],
    }),
  ];

  let content = "";
  if (!isTestCustomerEmail(email)) {
    content = buildContent([
      getSubscriptionExtraLine(plan, interval),
      getCompanyEasterEgg(email),
      getDomainIntelligence(email),
      getSampietroAlert(email),
    ]);

    const milestones = await buildSubscriptionMilestones({
      email,
      plan,
      interval,
      previousStatus: input.previousStatus ?? null,
    }).catch(() => []);
    embeds.push(...milestones);
  }

  await postWebhook({ content, embeds });
}

export async function notifyPlanUpgrade(input: PlanUpgradeInput): Promise<void> {
  if (!DISCORD_CUSTOMERS_WEBHOOK_URL) {
    return;
  }

  const email = input.email.trim();
  const fromPlan = normalizePlanId(input.fromPlan);
  const toPlan = normalizePlanId(input.toPlan);
  const toInterval = normalizeInterval(input.toInterval);

  const embeds: DiscordEmbed[] = [
    createEmbed({
      title: "⬆️ Plan upgrade",
      description: `**${email}** upgraded to **${getPlanLabel(toPlan)}**`,
      color: COLOR.GOLD,
      fields: [
        { name: "From", value: getPlanLabel(fromPlan), inline: true },
        { name: "To", value: getPlanLabel(toPlan), inline: true },
      ],
    }),
  ];

  let content = "";
  if (!isTestCustomerEmail(email)) {
    content = buildContent([
      getSubscriptionExtraLine(toPlan, toInterval),
      getCompanyEasterEgg(email),
      getDomainIntelligence(email),
      getSampietroAlert(email),
    ]);

    const milestones = await buildMrrMilestones({
      email,
      fromPlan,
      toPlan,
      fromInterval: normalizeInterval(input.fromInterval),
      toInterval,
    }).catch(() => []);
    embeds.push(...milestones);
  }

  await postWebhook({ content, embeds });
}

export async function notifySubscriptionRenewed(input: RenewalInput): Promise<void> {
  if (!DISCORD_CUSTOMERS_WEBHOOK_URL) {
    return;
  }

  const email = input.email.trim();
  const plan = normalizePlanId(input.plan);
  const content = isTestCustomerEmail(email)
    ? ""
    : buildContent([
        getCompanyEasterEgg(email),
        getDomainIntelligence(email),
        getSampietroAlert(email),
      ]);

  await postWebhook({
    content,
    embeds: [
      createEmbed({
        title: "🔄 Subscription renewed",
        description: `**${email}** renewed **${getPlanLabel(plan)}**`,
        color: COLOR.EMERALD,
        fields: [
          { name: "Plan", value: getPlanLabel(plan), inline: true },
          { name: "Credits granted", value: String(input.creditsGranted), inline: true },
        ],
      }),
    ],
  });
}

export async function notifyPaymentFailed(input: PaymentFailedInput): Promise<void> {
  if (!DISCORD_CUSTOMERS_WEBHOOK_URL) {
    return;
  }

  const email = input.email.trim();
  const plan = input.plan ? normalizePlanId(input.plan) : null;
  const content = isTestCustomerEmail(email)
    ? ""
    : buildContent([
        `⚠️ ${email}'s card bounced on ${getPlanLabel(plan)}. Stripe will retry. Fra, keep an eye on this.`,
        getCompanyEasterEgg(email),
        getDomainIntelligence(email),
        getSampietroAlert(email),
      ]);

  await postWebhook({
    content,
    embeds: [
      createEmbed({
        title: "⚠️ Payment failed",
        description: `**${email}** payment failed`,
        color: COLOR.ORANGE,
        fields: [{ name: "Plan", value: getPlanLabel(plan), inline: true }],
      }),
    ],
  });
}

export async function notifyCancellation(input: CancellationInput): Promise<void> {
  if (!DISCORD_CUSTOMERS_WEBHOOK_URL) {
    return;
  }

  const email = input.email.trim();
  const plan = input.plan ? normalizePlanId(input.plan) : null;
  const content = isTestCustomerEmail(email)
    ? ""
    : buildContent([
        `👋 ${email} left ${getPlanLabel(plan)}. Was it the price? The output? The vibes? Rossella, dig into their runs.`,
        getCompanyEasterEgg(email),
        getDomainIntelligence(email),
        getSampietroAlert(email),
      ]);

  await postWebhook({
    content,
    embeds: [
      createEmbed({
        title: "👋 Subscription canceled",
        description: `**${email}** canceled **${getPlanLabel(plan)}**`,
        color: COLOR.RED,
        fields: [{ name: "Plan", value: getPlanLabel(plan), inline: true }],
      }),
    ],
  });
}

async function postWebhook(input: {
  content?: string;
  embeds: DiscordEmbed[];
}) {
  if (!DISCORD_CUSTOMERS_WEBHOOK_URL) {
    return;
  }

  const payload: DiscordWebhookPayload = {
    username: "Basquio",
    avatar_url: BASQUIO_AVATAR_URL,
    embeds: input.embeds,
    allowed_mentions: { parse: [] },
  };

  if (input.content) {
    payload.content = input.content;
  }

  const response = await fetch(DISCORD_CUSTOMERS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`[discord-customers] ${response.status} ${text}`.trim());
  }
}

function createEmbed(embed: Omit<DiscordEmbed, "footer" | "timestamp">): DiscordEmbed {
  return {
    ...embed,
    footer: { text: "Basquio" },
    timestamp: new Date().toISOString(),
  };
}

async function buildSignupMilestone(email: string): Promise<DiscordEmbed | null> {
  const config = getRuntimeConfig();
  if (!config) {
    return null;
  }

  const signupCount = await getExternalSignupCount(config);
  if (signupCount === 1) {
    return createEmbed({
      title: "🎊 THE FIRST ONE",
      description: `**${email}** just signed up. The legend begins. Everyone drop what you're doing.`,
      color: COLOR.GOLD,
      image: { url: pickRandom(CELEBRATION_GIFS) },
    });
  }

  if (signupCount === 10) {
    return createEmbed({
      title: "🔥 Signup #10",
      description: "Double digits. 10 humans chose Basquio. Rossella owes everyone a spritz.",
      color: COLOR.GOLD,
    });
  }

  if (signupCount === 50) {
    return createEmbed({
      title: "🚀 Signup #50",
      description: "50 users. This is not a test anymore.",
      color: COLOR.GOLD,
    });
  }

  if (signupCount === 100) {
    return createEmbed({
      title: "💯 Signup #100",
      description: "100 users. Marco can finally stop saying 'iniziamo ad avere sti cazzo di users'",
      color: COLOR.GOLD,
    });
  }

  return null;
}

async function buildFirstRevenueMilestone(input: {
  email: string;
  amountLabel: string;
}): Promise<DiscordEmbed | null> {
  const config = getRuntimeConfig();
  if (!config) {
    return null;
  }

  const snapshot = await getRevenueSnapshot(config, input.email);
  if (snapshot.payerUserIds.size !== 1 || snapshot.currentUserRevenueEvents !== 1) {
    return null;
  }

  return createEmbed({
    title: "💸 FIRST REVENUE",
    description: `**${input.email}** just paid real money. ${input.amountLabel}. Frame this notification. Screenshot it. Print it. Ale, update the LinkedIn.`,
    color: COLOR.GOLD,
    image: { url: pickRandom(CELEBRATION_GIFS) },
  });
}

async function buildSubscriptionMilestones(input: {
  email: string;
  plan: PlanId;
  interval: "monthly" | "annual";
  previousStatus: string | null;
}): Promise<DiscordEmbed[]> {
  const config = getRuntimeConfig();
  if (!config) {
    return [];
  }

  const embeds: DiscordEmbed[] = [];
  const snapshot = await getRevenueSnapshot(config, input.email);
  const currentPlanValue = getMonthlyRecurringValue(input.plan, input.interval);

  if (snapshot.payerUserIds.size === 1 && snapshot.currentUserRevenueEvents === 1) {
    embeds.push(createEmbed({
      title: "💸 FIRST REVENUE",
      description: `**${input.email}** just paid real money. ${formatUsd(getSubscriptionChargeAmount(input.plan, input.interval))}. Frame this notification. Screenshot it. Print it. Ale, update the LinkedIn.`,
      color: COLOR.GOLD,
      image: { url: pickRandom(CELEBRATION_GIFS) },
    }));
  }

  if ((input.previousStatus == null || input.previousStatus === "incomplete") && snapshot.activeSubscriptionCount === 1) {
    embeds.push(createEmbed({
      title: "💳 FIRST SUBSCRIBER",
      description: `**${input.email}** is on **${getPlanLabel(input.plan)}**. Monthly recurring revenue exists. Fra, start the spreadsheet.`,
      color: COLOR.GOLD,
    }));
  }

  const previousMrr = Math.max(snapshot.currentMrr - currentPlanValue, 0);
  if (previousMrr < 100 && snapshot.currentMrr >= 100) {
    embeds.push(createEmbed({
      title: "📈 $100 MRR",
      description: decorateGiuliaLine("We're a real company now. Giulia, write the press release."),
      color: COLOR.GOLD,
    }));
  }
  if (previousMrr < 1000 && snapshot.currentMrr >= 1000) {
    embeds.push(createEmbed({
      title: "🏆 $1,000 MRR",
      description: "Veronica was right — 'questa cosa deve essere usata.'",
      color: COLOR.GOLD,
    }));
  }

  return embeds;
}

async function buildMrrMilestones(input: {
  email: string;
  fromPlan: PlanId;
  toPlan: PlanId;
  fromInterval: "monthly" | "annual";
  toInterval: "monthly" | "annual";
}): Promise<DiscordEmbed[]> {
  const config = getRuntimeConfig();
  if (!config) {
    return [];
  }

  const snapshot = await getRevenueSnapshot(config, input.email);
  const currentValue = getMonthlyRecurringValue(input.toPlan, input.toInterval);
  const previousValue = getMonthlyRecurringValue(input.fromPlan, input.fromInterval);
  const previousMrr = Math.max(snapshot.currentMrr - currentValue + previousValue, 0);
  const embeds: DiscordEmbed[] = [];

  if (previousMrr < 100 && snapshot.currentMrr >= 100) {
    embeds.push(createEmbed({
      title: "📈 $100 MRR",
      description: decorateGiuliaLine("We're a real company now. Giulia, write the press release."),
      color: COLOR.GOLD,
    }));
  }
  if (previousMrr < 1000 && snapshot.currentMrr >= 1000) {
    embeds.push(createEmbed({
      title: "🏆 $1,000 MRR",
      description: "Veronica was right — 'questa cosa deve essere usata.'",
      color: COLOR.GOLD,
    }));
  }

  return embeds;
}

async function getExternalSignupCount(config: RuntimeConfig): Promise<number> {
  const [signups, emailIndex] = await Promise.all([
    fetchRestRows<SignupRow>({
      ...config,
      table: "user_bootstrap_state",
      query: { select: "user_id" },
    }),
    listAuthUsers(config),
  ]);

  return signups.filter((row) => isExternalUserId(emailIndex, row.user_id)).length;
}

async function getRevenueSnapshot(config: RuntimeConfig, email: string): Promise<RevenueSnapshot> {
  const [emailIndex, subscriptions, grants] = await Promise.all([
    listAuthUsers(config),
    fetchRestRows<SubscriptionRow>({
      ...config,
      table: "subscriptions",
      query: { select: "user_id,plan,billing_interval,status" },
    }),
    fetchRestRows<CreditGrantRow>({
      ...config,
      table: "credit_grants",
      query: { select: "user_id,source", source: "eq.purchase" },
    }),
  ]);

  const payerUserIds = new Set<string>();
  let currentUserRevenueEvents = 0;
  let activeSubscriptionCount = 0;
  let currentMrr = 0;

  for (const grant of grants) {
    if (!isExternalUserId(emailIndex, grant.user_id)) {
      continue;
    }
    payerUserIds.add(grant.user_id);
    if (sameEmail(emailIndex.get(grant.user_id), email)) {
      currentUserRevenueEvents += 1;
    }
  }

  for (const subscription of subscriptions) {
    if (!isExternalUserId(emailIndex, subscription.user_id)) {
      continue;
    }

    payerUserIds.add(subscription.user_id);
    if (sameEmail(emailIndex.get(subscription.user_id), email)) {
      currentUserRevenueEvents += 1;
    }

    if (subscription.status === "active") {
      activeSubscriptionCount += 1;
      currentMrr += getMonthlyRecurringValue(
        normalizePlanId(subscription.plan),
        normalizeInterval(subscription.billing_interval),
      );
    }
  }

  return {
    payerUserIds,
    currentUserRevenueEvents,
    activeSubscriptionCount,
    currentMrr,
  };
}

async function listAuthUsers(config: RuntimeConfig): Promise<Map<string, string>> {
  const supabase = createServiceSupabaseClient(config.supabaseUrl, config.serviceKey);
  const emailIndex = new Map<string, string>();
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw error;
    }

    const users = data.users ?? [];
    for (const user of users) {
      emailIndex.set(user.id, (user.email ?? "").toLowerCase());
    }

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return emailIndex;
}

function getRuntimeConfig(): RuntimeConfig | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  return { supabaseUrl, serviceKey };
}

function isExternalUserId(emailIndex: Map<string, string>, userId: string): boolean {
  const email = emailIndex.get(userId);
  return typeof email === "string" && email.length > 0 && !isTestCustomerEmail(email);
}

function sameEmail(left: string | undefined, right: string): boolean {
  return (left ?? "").toLowerCase() === right.toLowerCase();
}

function getPlanLabel(plan: PlanId | null): string {
  if (!plan) {
    return "Unknown";
  }
  return PLAN_CONFIG[plan]?.label ?? "Unknown";
}

function getIntervalLabel(interval: "monthly" | "annual"): string {
  return interval === "annual" ? "Annual" : "Monthly";
}

function normalizeInterval(interval: string): "monthly" | "annual" {
  return interval === "annual" ? "annual" : "monthly";
}

function normalizePricingTier(tier: PackPricingTier | null | undefined): PackPricingTier {
  if (tier === "starter" || tier === "pro") {
    return tier;
  }
  return "free";
}

function getCreditPackExtraLine(packId: CreditPackId): string {
  switch (packId) {
    case "pack_25":
      return "Dipping a toe in. Smart.";
    case "pack_50":
      return "Getting serious.";
    case "pack_100":
      return "This person has reports to ship.";
    case "pack_250":
      return "🐋 Whale alert. Someone's building a deck factory.";
    default:
      return "Fresh credits in the tank.";
  }
}

function getSubscriptionExtraLine(plan: PlanId, interval: "monthly" | "annual"): string {
  if (plan === "starter" && interval === "monthly") {
    return "Ale, new Starter. Nurture this one.";
  }
  if (plan === "starter" && interval === "annual") {
    return "Annual commitment. They believe. Ale, send the thank you note.";
  }
  if (plan === "pro" && interval === "monthly") {
    return "🔥 Pro subscriber. This is a power user. Rossella, check their first deck.";
  }
  if (plan === "pro" && interval === "annual") {
    return "💎 PRO ANNUAL. $1,490 upfront. That's trust. Everyone say thank you.";
  }
  return "New subscriber on the board.";
}

function decorateGiuliaLine(line: string): string {
  if (!line.includes("Giulia") || line.includes("Sampietro")) {
    return line;
  }
  return `${line} ${pickRandom(GIULIA_SAMPIETRO_LINES)}`;
}

function getCompanyEasterEgg(email: string): string | null {
  const domain = getEmailDomain(email);
  if (!domain) {
    return null;
  }

  if (domain.endsWith("nielseniq.com")) {
    return "👀 Someone from NIQ is here. Act natural. Francesco, Rossella, Alessandro — you know what to do.";
  }
  if (domain.endsWith("mondelez.com")) {
    return "🍫 Mondelez in the house. Giulia, this is your moment.";
  }
  if (domain.endsWith("barilla.com")) {
    return "🍝 Barilla just signed up. The pasta people want decks.";
  }
  if (domain.endsWith("nestle.com")) {
    return "The biggest food company on earth just walked in. Everyone breathe.";
  }
  if (domain.endsWith(".edu")) {
    return "🎓 Academic user. They'll find all the bugs. Marco, brace yourself.";
  }
  if (domain.endsWith(".gov") || domain.includes(".gov.")) {
    return "🏛️ Government account. Everyone be on best behavior.";
  }

  return null;
}

function getDomainIntelligence(email: string): string | null {
  const domain = getEmailDomain(email);
  if (!domain) {
    return null;
  }
  if (getCompanyEasterEgg(email)) {
    return null;
  }

  if (domain === "gmail.com") {
    return pickRandom([
      "Gmail user. Probably building decks on their personal laptop because IT said no. We respect the hustle.",
      "Personal email. Either a freelancer or someone whose company hasn't discovered Basquio yet.",
      "Gmail energy. This person makes things happen outside office hours.",
    ]);
  }
  if (domain === "outlook.com" || domain === "hotmail.com") {
    return "Outlook user. Probably European. Probably in CPG. Probably has 47 Excel tabs open right now.";
  }
  if (domain === "yahoo.com") {
    return "Yahoo email in 2026. This person has seen things. Respect.";
  }
  if (!PERSONAL_EMAIL_DOMAINS.has(domain)) {
    if (domain.endsWith(".it")) {
      return "🇮🇹 Italian company. Home turf. Rossella, Francesco — è dei nostri.";
    }
    if (domain.endsWith(".de")) {
      return "🇩🇪 German company. They'll want the data to be perfect. No pressure.";
    }
    if (domain.endsWith(".fr")) {
      return "🇫🇷 French company. Bonjour les données.";
    }
    if (domain.endsWith(".co.uk") || domain.endsWith(".uk")) {
      return "🇬🇧 UK company. They'll want charts in pounds, not euros.";
    }
    if (domain.endsWith(".ch")) {
      return "🇨🇭 Swiss company. Veronica, this is your territory.";
    }
    return `Corporate email: **${domain}**. This could be a team. Ale, research them.`;
  }

  return null;
}

function getTimeBasedSignupEasterEgg(): string | null {
  const now = new Date();
  const parts = getZurichDateParts(now);

  if (parts.hour >= 0 && parts.hour < 5) {
    return `🌙 A night owl. They're building decks at ${parts.timeLabel}. Respect.`;
  }

  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return "📅 Weekend warrior. This person doesn't wait for Monday.";
  }

  return null;
}

function getAleJapaneseLine(email: string): string | null {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.includes("alessandro") || local === "ale" || local.startsWith("ale.")) {
    return "アレ、新しいメールで来たね。ようこそ。今日も最高のデッキを作ろう。";
  }
  return null;
}

function getSampietroAlert(email: string): string | null {
  const normalized = email.toLowerCase();
  if (!normalized.includes("sampietro")) {
    return null;
  }
  return "🚨 CODICE ROSSO. Una Sampietro si è iscritta. Giulia, respira. Probabilmente non è lei. ...Probabilmente.";
}

function getEmailDomain(email: string): string | null {
  const parts = email.toLowerCase().split("@");
  return parts[1] ?? null;
}

function getMonthlyRecurringValue(plan: PlanId, interval: "monthly" | "annual"): number {
  const config = PLAN_CONFIG[plan];
  if (!config) {
    return 0;
  }
  return interval === "annual" ? config.annualPrice / 12 : config.monthlyPrice;
}

function getSubscriptionChargeAmount(plan: PlanId, interval: "monthly" | "annual"): number {
  const config = PLAN_CONFIG[plan];
  if (!config) {
    return 0;
  }
  return interval === "annual" ? config.annualPrice : config.monthlyPrice;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function getZurichDateParts(date: Date): {
  hour: number;
  weekday: string;
  timeLabel: string;
} {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: CUSTOMERS_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number.parseInt(partMap.hour ?? "0", 10);
  const minute = partMap.minute ?? "00";

  return {
    hour,
    weekday: partMap.weekday ?? "",
    timeLabel: `${partMap.hour ?? "00"}:${minute} ${CUSTOMERS_TIMEZONE}`,
  };
}

function pickRandom<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)] as T;
}

function buildContent(values: Array<string | null | undefined>): string {
  return compact(values).map(decorateGiuliaLine).join("\n");
}

function compact(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim());
}
