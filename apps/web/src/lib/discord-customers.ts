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
import { DOWNLOAD_TRACKING_FLOOR } from "@/lib/engagement";
import { getStripe } from "@/lib/stripe";
import { createServiceSupabaseClient, fetchRestRows } from "@/lib/supabase/admin";

const DISCORD_CUSTOMERS_WEBHOOK_URL = process.env.DISCORD_CUSTOMERS_WEBHOOK_URL;
const DISCORD_GENERAL_WEBHOOK_URL = process.env.DISCORD_GENERAL_WEBHOOK_URL;
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
  `${FREE_TIER_CREDITS} free credits. Let's see what they build.`,
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
  created_at?: string;
};

type CreditGrantRow = {
  user_id: string;
  source: string;
  original_amount?: number;
  created_at?: string;
};

type SignupRow = {
  user_id: string;
  first_authenticated_at?: string;
};

type IntercomThreadRow = {
  intercom_conversation_id: string;
};

type RevenueSnapshot = {
  payerUserIds: Set<string>;
  currentUserRevenueEvents: number;
  activeSubscriptionCount: number;
  currentMrr: number;
};

type WeeklyRevenueSummary = {
  signupCount: number;
  newSubscriberCount: number;
  subscriberBreakdownLabel: string;
  creditPackCount: number;
  creditPackRevenue: number;
  currentMrr: number;
  totalRevenue: number;
  topCustomerLabel: string;
  // Product metrics
  runsCompleted: number;
  runsFailed: number;
  completionRate: number;
  modelMixLabel: string;
  avgDurationMin: number;
  avgCostUsd: number;
  totalSlides: number;
  runsDownloaded: number;
  runsUnclaimed: number;
  // User metrics
  activeUsers: number;
  totalExternalUsers: number;
  firstTimeRunners: number;
  returningRunners: number;
  neverRanCount: number;
  userActivityLines: string[];
  // Engagement metrics
  emailsSentBreakdown: string[];
  // Collab metrics
  sessionCount: number;
  sessionMinutes: number;
  decisionCount: number;
  leadCount: number;
  topQuotes: string[];
  // Credit metrics
  creditsConsumed: number;
  creditsGranted: number;
};

type SignupInput = {
  email: string;
  sourceLabel?: string | null;
  occurredAt?: Date;
};

type CreditPurchaseInput = {
  email: string;
  packId: CreditPackId;
  pricingTier?: PackPricingTier | null;
};

type TemplateFeePaymentInput = {
  email: string;
  amountUsd: number;
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
      getTimeBasedSignupEasterEgg(input.occurredAt),
      getAleJapaneseLine(email),
    ]);

    const milestone = await buildSignupMilestone(email).catch(() => null);
    if (milestone) {
      embeds.push(milestone);
    }

    const panicEmbed = buildSampietroPanicEmbed(email);
    if (panicEmbed) {
      embeds.push(panicEmbed);
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
    ]);

    const milestone = await buildFirstRevenueMilestone({
      email,
      amountLabel,
    }).catch(() => null);
    if (milestone) {
      embeds.push(milestone);
    }

    const panicEmbed = buildSampietroPanicEmbed(email);
    if (panicEmbed) {
      embeds.push(panicEmbed);
    }

  }

  await postWebhook({ content, embeds });
}

export async function notifyTemplateFeePayment(input: TemplateFeePaymentInput): Promise<void> {
  if (!DISCORD_CUSTOMERS_WEBHOOK_URL) {
    return;
  }

  const email = input.email.trim();
  const amountLabel = formatUsd(input.amountUsd);
  const embeds: DiscordEmbed[] = [
    createEmbed({
      title: "🎨 Template fee paid",
      description: `**${email}** paid **${amountLabel}** for custom template access`,
      color: COLOR.EMERALD,
      fields: [
        { name: "Type", value: "Template fee", inline: true },
        { name: "Amount", value: amountLabel, inline: true },
      ],
    }),
  ];

  if (!isTestCustomerEmail(email)) {
    const firstRevenueMilestone = await buildFirstRevenueMilestone({
      email,
      amountLabel,
    });
    if (firstRevenueMilestone) {
      embeds.push(firstRevenueMilestone);
    }
  }

  await postWebhook({ embeds });
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
    ]);

    const milestones = await buildSubscriptionMilestones({
      email,
      plan,
      interval,
      previousStatus: input.previousStatus ?? null,
    }).catch(() => []);
    embeds.push(...milestones);

    const panicEmbed = buildSampietroPanicEmbed(email);
    if (panicEmbed) {
      embeds.push(panicEmbed);
    }

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
    ]);

    const milestones = await buildMrrMilestones({
      email,
      fromPlan,
      toPlan,
      fromInterval: normalizeInterval(input.fromInterval),
      toInterval,
    }).catch(() => []);
    embeds.push(...milestones);

    const panicEmbed = buildSampietroPanicEmbed(email);
    if (panicEmbed) {
      embeds.push(panicEmbed);
    }

  }

  await postWebhook({ content, embeds });
}

export async function notifySubscriptionRenewed(input: RenewalInput): Promise<void> {
  if (!DISCORD_CUSTOMERS_WEBHOOK_URL) {
    return;
  }

  const email = input.email.trim();
  const plan = normalizePlanId(input.plan);
  const embeds: DiscordEmbed[] = [
    createEmbed({
      title: "🔄 Subscription renewed",
      description: `**${email}** renewed **${getPlanLabel(plan)}**`,
      color: COLOR.EMERALD,
      fields: [
        { name: "Plan", value: getPlanLabel(plan), inline: true },
        { name: "Credits granted", value: String(input.creditsGranted), inline: true },
      ],
    }),
  ];
  const content = isTestCustomerEmail(email)
    ? ""
    : buildContent([getCompanyEasterEgg(email), getDomainIntelligence(email)]);

  if (!isTestCustomerEmail(email)) {
    const panicEmbed = buildSampietroPanicEmbed(email);
    if (panicEmbed) {
      embeds.push(panicEmbed);
    }
  }

  await postWebhook({
    content,
    embeds,
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
      ]);
  const embeds: DiscordEmbed[] = [
    createEmbed({
      title: "⚠️ Payment failed",
      description: `**${email}** payment failed`,
      color: COLOR.ORANGE,
      fields: [{ name: "Plan", value: getPlanLabel(plan), inline: true }],
    }),
  ];

  if (!isTestCustomerEmail(email)) {
    const panicEmbed = buildSampietroPanicEmbed(email);
    if (panicEmbed) {
      embeds.push(panicEmbed);
    }
  }

  await postWebhook({
    content,
    embeds,
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
      ]);
  const embeds: DiscordEmbed[] = [
    createEmbed({
      title: "👋 Subscription canceled",
      description: `**${email}** canceled **${getPlanLabel(plan)}**`,
      color: COLOR.RED,
      fields: [{ name: "Plan", value: getPlanLabel(plan), inline: true }],
    }),
  ];

  if (!isTestCustomerEmail(email)) {
    const panicEmbed = buildSampietroPanicEmbed(email);
    if (panicEmbed) {
      embeds.push(panicEmbed);
    }
  }

  await postWebhook({
    content,
    embeds,
  });
}

export async function postWeeklyRevenueSummary(input?: {
  occurredAt?: Date;
}): Promise<WeeklyRevenueSummary | null> {
  const webhookUrl = DISCORD_GENERAL_WEBHOOK_URL ?? DISCORD_CUSTOMERS_WEBHOOK_URL;
  if (!webhookUrl) {
    return null;
  }

  const config = getRuntimeConfig();
  if (!config) {
    return null;
  }

  const summary = await buildWeeklyRevenueSummary(config, input?.occurredAt ?? new Date());

  const weekEnd = input?.occurredAt ?? new Date();
  const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dateRange = formatWeekRange(weekStart, weekEnd);

  const lines: (string | null)[] = [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "**PRODUCT**",
    `Runs: ${summary.runsCompleted + summary.runsFailed} (${summary.runsCompleted} completed, ${summary.runsFailed} failed)`,
    summary.runsCompleted > 0 ? `Completion rate: ${summary.completionRate}%` : null,
    summary.modelMixLabel ? `Model mix: ${summary.modelMixLabel}` : null,
    summary.avgDurationMin > 0 ? `Avg time: ${Math.round(summary.avgDurationMin)} min` : null,
    summary.avgCostUsd > 0 ? `Avg cost: ${formatUsd(summary.avgCostUsd)}/run` : null,
    summary.totalSlides > 0 ? `Slides generated: ${summary.totalSlides}` : null,
    summary.runsCompleted > 0 ? `Downloads: ${summary.runsDownloaded} runs downloaded, ${summary.runsUnclaimed} unclaimed` : null,
    "",
    "**USERS**",
    `New signups: ${summary.signupCount} (${summary.totalExternalUsers} total external)`,
    `Ran this week: ${summary.activeUsers} users (${summary.totalExternalUsers > 0 ? Math.round(summary.activeUsers / summary.totalExternalUsers * 100) : 0}% of external)`,
    summary.firstTimeRunners > 0 ? `First-time runners: ${summary.firstTimeRunners}` : null,
    summary.returningRunners > 0 ? `Returning runners: ${summary.returningRunners}` : null,
    summary.neverRanCount > 0 ? `Never ran: ${summary.neverRanCount} users sitting on free credits` : null,
    "",
    "**REVENUE**",
    `MRR: ${formatUsd(summary.currentMrr)}`,
    `Credit packs: ${summary.creditPackCount} (${formatUsd(summary.creditPackRevenue)})`,
    `Total revenue: ${formatUsd(summary.totalRevenue)}`,
    summary.topCustomerLabel !== "None yet" ? `Top customer: ${summary.topCustomerLabel}` : null,
    `Credits consumed: ${summary.creditsConsumed}`,
    `Credits granted: ${summary.creditsGranted}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ];

  if (summary.userActivityLines.length > 0) {
    lines.push("", "**\uD83D\uDC64 User Activity**");
    lines.push(...summary.userActivityLines);
  }

  if (summary.emailsSentBreakdown.length > 0) {
    lines.push("", "**\uD83D\uDCEC Emails Sent**");
    lines.push(...summary.emailsSentBreakdown);
  }

  if (summary.sessionCount > 0 || summary.decisionCount > 0 || summary.leadCount > 0) {
    lines.push("", "**\uD83C\uDFA4 Team**");
    if (summary.sessionCount > 0) lines.push(`Sessions: ${summary.sessionCount} (${summary.sessionMinutes} min total)`);
    if (summary.decisionCount > 0) lines.push(`Decisions: ${summary.decisionCount}`);
    if (summary.leadCount > 0) lines.push(`New leads: ${summary.leadCount}`);
    if (summary.topQuotes.length > 0) {
      for (const q of summary.topQuotes.slice(0, 3)) {
        lines.push(`> "${q}"`);
      }
    }
  }

  lines.push("", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const description = lines.filter((line): line is string => line !== null).join("\n");

  // Discord embed description limit is 4096 chars. Truncate if needed.
  const truncated = description.length > 4090 ? description.slice(0, 4087) + "..." : description;

  await postToWebhookUrl(webhookUrl, {
    content: "\"Non puo rimanere fra noi 6 sta cosa\" \u2014 Veronica",
    embeds: [
      createEmbed({
        title: `\uD83D\uDCCA Week of ${dateRange}`,
        description: truncated,
        color: COLOR.BLURPLE,
      }),
    ],
  });

  return summary;
}

async function postToWebhookUrl(
  webhookUrl: string,
  input: { content?: string; embeds: DiscordEmbed[] },
) {
  const payload: DiscordWebhookPayload = {
    username: "Basquio",
    avatar_url: BASQUIO_AVATAR_URL,
    embeds: input.embeds,
    allowed_mentions: { parse: [] },
  };

  if (input.content) {
    payload.content = input.content;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`[discord] ${response.status} ${text}`.trim());
  }
}

async function postWebhook(input: {
  content?: string;
  embeds: DiscordEmbed[];
}) {
  if (!DISCORD_CUSTOMERS_WEBHOOK_URL) {
    return;
  }
  await postToWebhookUrl(DISCORD_CUSTOMERS_WEBHOOK_URL, input);
}

function formatWeekRange(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: CUSTOMERS_TIMEZONE,
    month: "long",
    day: "numeric",
  });
  const yearFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: CUSTOMERS_TIMEZONE,
    year: "numeric",
  });
  return `${fmt.format(start)}\u2013${fmt.format(end)}, ${yearFmt.format(end)}`;
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

  const [signupCount, intercomThreadCount] = await Promise.all([
    getExternalSignupCount(config),
    getIntercomThreadCount(config),
  ]);

  if (signupCount === 1 && intercomThreadCount === 0) {
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
      query: { select: "user_id,first_authenticated_at" },
    }),
    listAuthUsers(config),
  ]);

  return signups.filter((row) => isExternalUserId(emailIndex, row.user_id)).length;
}

async function getIntercomThreadCount(config: RuntimeConfig): Promise<number> {
  const rows = await fetchRestRows<IntercomThreadRow>({
    ...config,
    table: "intercom_threads",
    query: {
      select: "intercom_conversation_id",
    },
  }).catch(() => []);

  return rows.length;
}

async function getRevenueSnapshot(config: RuntimeConfig, email: string): Promise<RevenueSnapshot> {
  const [emailIndex, subscriptions, grants] = await Promise.all([
    listAuthUsers(config),
    fetchRestRows<SubscriptionRow>({
      ...config,
      table: "subscriptions",
      query: { select: "user_id,plan,billing_interval,status,created_at" },
    }),
    fetchRestRows<CreditGrantRow>({
      ...config,
      table: "credit_grants",
      query: { select: "user_id,source,original_amount,created_at", source: "eq.purchase" },
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

type DeckRunRow = {
  id: string;
  requested_by: string;
  status: string;
  author_model: string | null;
  delivery_status: string | null;
  cost_telemetry: string | null;
  created_at: string;
  completed_at: string | null;
};

type ManifestRow = { run_id: string; slide_count: number };
type DownloadRow = { run_id: string; requested_by: string };
type EngagementNotifRow = { notification_type: string; user_id: string };
type CreditLedgerRow = { user_id: string; amount: number; reason: string };
type TranscriptRow = { id: string; duration_seconds: number | null; key_quotes: string[] | null };
type DecisionRow = { id: string };
type CrmLeadRow = { id: string };

async function buildWeeklyRevenueSummary(
  config: RuntimeConfig,
  occurredAt: Date,
): Promise<WeeklyRevenueSummary> {
  const weekStart = new Date(occurredAt.getTime() - (7 * 24 * 60 * 60 * 1000));
  const weekStartIso = weekStart.toISOString();
  const emailIndex = await listAuthUsers(config);

  const [
    signups,
    subscriptions,
    creditPackEvents,
    subscriptionRevenueEvents,
    weekRuns,
    weekDownloads,
    weekManifests,
    weekEngagement,
    weekCompletionEmails,
    weekWelcomeEmails,
    weekCreditLedger,
    allRuns,
    weekTranscripts,
    weekDecisions,
    weekLeads,
  ] = await Promise.all([
    // Existing revenue queries
    fetchRestRows<SignupRow>({
      ...config,
      table: "user_bootstrap_state",
      query: {
        select: "user_id,first_authenticated_at",
        first_authenticated_at: `gte.${weekStartIso}`,
      },
    }).catch(() => [] as SignupRow[]),
    fetchRestRows<SubscriptionRow>({
      ...config,
      table: "subscriptions",
      query: {
        select: "user_id,plan,billing_interval,status,created_at",
      },
    }).catch(() => [] as SubscriptionRow[]),
    listWeeklyCreditPackRevenueEvents(emailIndex, weekStart).catch(() => [] as Array<{ amount: number; email: string; label: string }>),
    listWeeklySubscriptionRevenueEvents(emailIndex, weekStart).catch(() => [] as Array<{ amount: number; email: string; label: string }>),

    // Product queries
    fetchRestRows<DeckRunRow>({
      ...config,
      table: "deck_runs",
      query: {
        select: "id,requested_by,status,author_model,delivery_status,cost_telemetry,created_at,completed_at",
        created_at: `gte.${weekStartIso}`,
        order: "created_at.desc",
      },
    }).catch(() => [] as DeckRunRow[]),
    fetchRestRows<DownloadRow>({
      ...config,
      table: "artifact_download_events",
      query: {
        select: "run_id,requested_by",
        created_at: `gte.${weekStartIso}`,
      },
    }).catch(() => [] as DownloadRow[]),
    fetchRestRows<ManifestRow>({
      ...config,
      table: "artifact_manifests_v2",
      query: {
        select: "run_id,slide_count",
        published_at: `gte.${weekStartIso}`,
      },
    }).catch(() => [] as ManifestRow[]),
    fetchRestRows<EngagementNotifRow>({
      ...config,
      table: "user_engagement_notifications",
      query: {
        select: "notification_type,user_id",
        sent_at: `gte.${weekStartIso}`,
      },
    }).catch(() => [] as EngagementNotifRow[]),
    fetchRestRows<{ id: string }>({
      ...config,
      table: "deck_runs",
      query: {
        select: "id",
        completion_email_sent_at: `gte.${weekStartIso}`,
      },
    }).catch(() => [] as { id: string }[]),
    fetchRestRows<{ user_id: string }>({
      ...config,
      table: "user_bootstrap_state",
      query: {
        select: "user_id",
        welcome_email_sent_at: `gte.${weekStartIso}`,
      },
    }).catch(() => [] as { user_id: string }[]),
    fetchRestRows<CreditLedgerRow>({
      ...config,
      table: "credit_ledger",
      query: {
        select: "user_id,amount,reason",
        created_at: `gte.${weekStartIso}`,
      },
    }).catch(() => [] as CreditLedgerRow[]),

    // All runs ever (for first-time vs returning calculation)
    fetchRestRows<{ requested_by: string; created_at: string }>({
      ...config,
      table: "deck_runs",
      query: {
        select: "requested_by,created_at",
        created_at: `lt.${weekStartIso}`,
      },
    }).catch(() => [] as { requested_by: string; created_at: string }[]),

    // Collab queries
    fetchRestRows<TranscriptRow>({
      ...config,
      table: "transcripts",
      query: {
        select: "id,duration_seconds,key_quotes",
        started_at: `gte.${weekStartIso}`,
      },
    }).catch(() => [] as TranscriptRow[]),
    fetchRestRows<DecisionRow>({
      ...config,
      table: "decisions",
      query: {
        select: "id",
        created_at: `gte.${weekStartIso}`,
      },
    }).catch(() => [] as DecisionRow[]),
    fetchRestRows<CrmLeadRow>({
      ...config,
      table: "crm_leads",
      query: {
        select: "id",
        created_at: `gte.${weekStartIso}`,
      },
    }).catch(() => [] as CrmLeadRow[]),
  ]);

  // ── Revenue (existing logic, unchanged) ──────────────────────────
  const signupCount = signups.filter((row) => isExternalUserId(emailIndex, row.user_id)).length;
  const newSubscriptions = subscriptions.filter((subscription) => {
    if (!isExternalUserId(emailIndex, subscription.user_id)) return false;
    if (!subscription.created_at || subscription.created_at < weekStartIso) return false;
    return subscription.status !== "incomplete";
  });

  const planBreakdown = new Map<PlanId, number>();
  for (const subscription of newSubscriptions) {
    const plan = normalizePlanId(subscription.plan);
    planBreakdown.set(plan, (planBreakdown.get(plan) ?? 0) + 1);
  }

  const subscriberBreakdownLabel = Array.from(planBreakdown.entries())
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => getPlanWeight(right) - getPlanWeight(left))
    .map(([plan, count]) => `${count} ${getPlanLabel(plan)}`)
    .join(", ");

  const currentMrr = subscriptions.reduce((total, subscription) => {
    if (!isExternalUserId(emailIndex, subscription.user_id) || subscription.status !== "active") return total;
    return total + getMonthlyRecurringValue(
      normalizePlanId(subscription.plan),
      normalizeInterval(subscription.billing_interval),
    );
  }, 0);

  const creditPackRevenue = sumAmounts(creditPackEvents.map((event) => event.amount));
  const subscriptionRevenue = sumAmounts(subscriptionRevenueEvents.map((event) => event.amount));
  const topCustomer = [...creditPackEvents, ...subscriptionRevenueEvents]
    .sort((left, right) => right.amount - left.amount)[0];

  // ── Product metrics ──────────────────────────────────────────────
  const externalRuns = weekRuns.filter((r) => isExternalUserId(emailIndex, r.requested_by));
  const runsCompleted = externalRuns.filter((r) => r.status === "completed").length;
  const runsFailed = externalRuns.filter((r) => r.status === "failed" || r.status === "terminated").length;
  const completionRate = externalRuns.length > 0 ? Math.round(runsCompleted / externalRuns.length * 100) : 0;

  // Model mix
  const modelCounts = new Map<string, number>();
  for (const run of externalRuns) {
    const model = run.author_model ?? "unknown";
    const label = model.includes("sonnet") ? "Sonnet"
      : model.includes("opus") ? "Opus"
      : model.includes("haiku") ? "Haiku"
      : model;
    modelCounts.set(label, (modelCounts.get(label) ?? 0) + 1);
  }
  const modelMixLabel = Array.from(modelCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([model, count]) => `${count} ${model}`)
    .join(", ");

  // Avg duration
  const completedWithTime = externalRuns.filter(
    (r) => r.status === "completed" && r.completed_at && r.created_at,
  );
  const avgDurationMin = completedWithTime.length > 0
    ? completedWithTime.reduce((sum, r) => {
        return sum + (new Date(r.completed_at!).getTime() - new Date(r.created_at).getTime());
      }, 0) / completedWithTime.length / 60_000
    : 0;

  // Avg cost
  const costs = completedWithTime.map((r) => {
    try { return JSON.parse(r.cost_telemetry ?? "{}").estimatedCostUsd ?? 0; }
    catch { return 0; }
  }).filter((c: number) => c > 0);
  const avgCostUsd = costs.length > 0 ? costs.reduce((a: number, b: number) => a + b, 0) / costs.length : 0;

  // Slides
  const completedRunIds = new Set(externalRuns.filter((r) => r.status === "completed").map((r) => r.id));
  const totalSlides = weekManifests
    .filter((m) => completedRunIds.has(m.run_id))
    .reduce((sum, m) => sum + (m.slide_count ?? 0), 0);

  // Downloads — tracking was deployed 2026-04-11T15:00:00Z.
  // Runs that completed before that have no download data. Don't count them as "unclaimed".
  const downloadedRunIds = new Set(weekDownloads.map((d) => d.run_id));
  const trackableCompletedRuns = externalRuns.filter(
    (r) => r.status === "completed" && r.completed_at && r.completed_at >= DOWNLOAD_TRACKING_FLOOR,
  );
  const trackableRunIds = new Set(trackableCompletedRuns.map((r) => r.id));
  const runsDownloaded = [...trackableRunIds].filter((id) => downloadedRunIds.has(id)).length;
  const runsUnclaimed = trackableRunIds.size - runsDownloaded;

  // ── User metrics ─────────────────────────────────────────────────
  const totalExternalUsers = [...emailIndex.entries()]
    .filter(([, email]) => !isTestCustomerEmail(email)).length;

  const usersWhoRanThisWeek = new Set(
    externalRuns.map((r) => r.requested_by),
  );
  const activeUsers = usersWhoRanThisWeek.size;

  const usersWithOlderRuns = new Set(
    allRuns
      .filter((r) => isExternalUserId(emailIndex, r.requested_by))
      .map((r) => r.requested_by),
  );

  let firstTimeRunners = 0;
  let returningRunners = 0;
  for (const userId of usersWhoRanThisWeek) {
    if (usersWithOlderRuns.has(userId)) {
      returningRunners++;
    } else {
      firstTimeRunners++;
    }
  }

  // Users who have never run anything
  const usersWhoEverRan = new Set([...usersWithOlderRuns, ...usersWhoRanThisWeek]);
  const neverRanCount = totalExternalUsers - usersWhoEverRan.size;

  // ── User activity lines ──────────────────────────────────────────
  const userActivityLines: string[] = [];
  const externalUserIds = [...emailIndex.entries()]
    .filter(([, email]) => !isTestCustomerEmail(email))
    .map(([id]) => id);

  // Gather per-user status for users who did something this week
  const activeUserDetails: Array<{ email: string; line: string; weight: number }> = [];
  const ghostEmails: string[] = [];

  for (const userId of externalUserIds) {
    const email = emailIndex.get(userId) ?? "";
    const firstName = email.split("@")[0];
    const userRuns = externalRuns.filter((r) => r.requested_by === userId);
    const userSignedUpThisWeek = signups.some((s) => s.user_id === userId);
    const userDownloaded = weekDownloads.some((d) => d.requested_by === userId);
    const completed = userRuns.some((r) => r.status === "completed");
    const failed = userRuns.some((r) => r.status === "failed" || r.status === "terminated");

    if (userRuns.length > 0) {
      // User ran something this week.
      // Only judge download status for runs that completed after tracking was deployed.
      const hasTrackableCompletedRun = userRuns.some(
        (r) => r.status === "completed" && r.completed_at && r.completed_at >= DOWNLOAD_TRACKING_FLOOR,
      );
      const canJudgeDownload = hasTrackableCompletedRun;

      if (completed && userDownloaded) {
        activeUserDetails.push({ email, line: `\u2705 ${firstName} \u2014 ran, downloaded`, weight: 3 });
      } else if (completed && !userDownloaded && canJudgeDownload) {
        activeUserDetails.push({ email, line: `\u26A0\uFE0F ${firstName} \u2014 ran, never downloaded`, weight: 4 });
      } else if (completed && !canJudgeDownload) {
        activeUserDetails.push({ email, line: `\u2705 ${firstName} \u2014 ran`, weight: 3 });
      } else if (failed && !completed) {
        activeUserDetails.push({ email, line: `\u274C ${firstName} \u2014 failed, hasn't retried`, weight: 5 });
      } else if (failed && completed) {
        activeUserDetails.push({ email, line: `\u2705 ${firstName} \u2014 ran after retry`, weight: 3 });
      }
    } else if (userSignedUpThisWeek) {
      // Signed up this week but never ran
      ghostEmails.push(firstName);
    }
  }

  // Sort: problems first (higher weight), then successes
  activeUserDetails.sort((a, b) => b.weight - a.weight);
  for (const detail of activeUserDetails.slice(0, 15)) {
    userActivityLines.push(detail.line);
  }
  if (activeUserDetails.length > 15) {
    userActivityLines.push(`... and ${activeUserDetails.length - 15} more`);
  }
  if (ghostEmails.length > 0) {
    userActivityLines.push(`\uD83D\uDC7B ${ghostEmails.join(", ")} \u2014 signed up, nothing`);
  }

  // ── Engagement emails ────────────────────────────────────────────
  const emailsSentBreakdown: string[] = [];
  const welcomeCount = weekWelcomeEmails.length;
  const completionEmailCount = weekCompletionEmails.length;

  const engagementCounts = new Map<string, number>();
  for (const notif of weekEngagement) {
    const type = notif.notification_type;
    engagementCounts.set(type, (engagementCounts.get(type) ?? 0) + 1);
  }

  const emailLabels: Record<string, string> = {
    low_credits: "Low credits",
    run_waiting: "Still waiting",
    unfinished_setup: "Setup reminder",
  };

  const emailParts: string[] = [];
  if (welcomeCount > 0) emailParts.push(`Welcome: ${welcomeCount}`);
  if (completionEmailCount > 0) emailParts.push(`Completion: ${completionEmailCount}`);
  for (const [type, count] of engagementCounts) {
    emailParts.push(`${emailLabels[type] ?? type}: ${count}`);
  }
  if (emailParts.length > 0) {
    emailsSentBreakdown.push(emailParts.join(" \u00B7 "));
  }

  // ── Collab metrics ───────────────────────────────────────────────
  const sessionCount = weekTranscripts.length;
  const sessionMinutes = Math.round(
    weekTranscripts.reduce((sum, t) => sum + (t.duration_seconds ?? 0), 0) / 60,
  );
  const allQuotes = weekTranscripts.flatMap((t) => t.key_quotes ?? []);
  const decisionCount = weekDecisions.length;
  const leadCount = weekLeads.length;

  // ── Credit metrics ───────────────────────────────────────────────
  const creditsConsumed = Math.abs(
    weekCreditLedger
      .filter((e) => e.amount < 0 && isExternalUserId(emailIndex, e.user_id))
      .reduce((sum, e) => sum + e.amount, 0),
  );
  const creditsGranted = weekCreditLedger
    .filter((e) => e.amount > 0 && isExternalUserId(emailIndex, e.user_id))
    .reduce((sum, e) => sum + e.amount, 0);

  return {
    signupCount,
    newSubscriberCount: newSubscriptions.length,
    subscriberBreakdownLabel,
    creditPackCount: creditPackEvents.length,
    creditPackRevenue,
    currentMrr,
    totalRevenue: creditPackRevenue + subscriptionRevenue,
    topCustomerLabel: topCustomer ? `${topCustomer.email} (${topCustomer.label})` : "None yet",
    runsCompleted,
    runsFailed,
    completionRate,
    modelMixLabel,
    avgDurationMin,
    avgCostUsd,
    totalSlides,
    runsDownloaded,
    runsUnclaimed,
    activeUsers,
    totalExternalUsers,
    firstTimeRunners,
    returningRunners,
    neverRanCount,
    userActivityLines,
    emailsSentBreakdown,
    sessionCount,
    sessionMinutes,
    decisionCount,
    leadCount,
    topQuotes: allQuotes.slice(0, 5),
    creditsConsumed,
    creditsGranted,
  };
}

async function listWeeklyCreditPackRevenueEvents(
  emailIndex: Map<string, string>,
  weekStart: Date,
): Promise<Array<{ amount: number; email: string; label: string }>> {
  const stripe = getStripe();
  const events: Array<{ amount: number; email: string; label: string }> = [];
  const created = { gte: Math.floor(weekStart.getTime() / 1000) };

  for await (const session of stripe.checkout.sessions.list({ limit: 100, created })) {
    if (session.payment_status !== "paid" || session.metadata?.type === "subscription") {
      continue;
    }

    const email = resolveRevenueEventEmail({
      userId: session.metadata?.user_id ?? null,
      fallbackEmail: session.customer_details?.email ?? null,
      emailIndex,
    });

    if (!email || isTestCustomerEmail(email)) {
      continue;
    }

    const packId = session.metadata?.pack_id as CreditPackId | undefined;
    const label = session.metadata?.type === "template_fee"
      ? "Template fee"
      : packId
        ? `${CREDIT_PACK_CATALOG[packId].credits} credit pack`
        : "Credit pack";

    events.push({
      amount: (session.amount_total ?? 0) / 100,
      email,
      label,
    });
  }

  return events;
}

async function listWeeklySubscriptionRevenueEvents(
  emailIndex: Map<string, string>,
  weekStart: Date,
): Promise<Array<{ amount: number; email: string; label: string }>> {
  const stripe = getStripe();
  const events: Array<{ amount: number; email: string; label: string }> = [];
  const created = { gte: Math.floor(weekStart.getTime() / 1000) };

  for await (const invoice of stripe.invoices.list({ limit: 100, created })) {
    const invoiceData = invoice as typeof invoice & {
      subscription?: string | { id: string } | null;
      parent?: {
        type?: string | null;
        subscription_details?: {
          subscription?: string | { id: string } | null;
          metadata?: Record<string, string> | null;
        } | null;
      } | null;
      subscription_details?: { metadata?: Record<string, string> | null } | null;
      metadata?: Record<string, string> | null;
      customer_email?: string | null;
      amount_paid?: number | null;
      lines: {
        data: Array<{
          price?: { recurring?: { interval?: string | null } | null } | null;
          parent?: {
            type?: string | null;
            subscription_item_details?: {
              subscription?: string | { id: string } | null;
            } | null;
          } | null;
        }>;
      };
    };

    const subscriptionId = normalizeStripeReference(invoiceData.subscription)
      ?? (invoiceData.parent?.type === "subscription_details"
        ? normalizeStripeReference(invoiceData.parent.subscription_details?.subscription)
        : null)
      ?? invoiceData.lines.data
        .map((line) => line.parent?.type === "subscription_item_details"
          ? normalizeStripeReference(line.parent.subscription_item_details?.subscription)
          : null)
        .find(Boolean)
      ?? null;

    if (invoiceData.status !== "paid" || !subscriptionId) {
      continue;
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId).catch(() => null);
    const metadata =
      (invoiceData.parent?.type === "subscription_details"
        ? invoiceData.parent.subscription_details?.metadata
        : null)
      ?? invoiceData.subscription_details?.metadata
      ?? invoiceData.metadata
      ?? subscription?.metadata
      ?? {};
    const email = resolveRevenueEventEmail({
      userId: metadata.user_id ?? null,
      fallbackEmail: invoiceData.customer_email ?? null,
      emailIndex,
    });

    if (!email || isTestCustomerEmail(email)) {
      continue;
    }

    const plan = normalizePlanId(metadata.plan);
    const invoiceLines = invoiceData.lines.data as Array<{
      price?: { recurring?: { interval?: string | null } | null } | null;
    }>;
    const recurringInterval =
      invoiceLines.find((line) => line.price?.recurring)?.price?.recurring?.interval
      ?? subscription?.items.data[0]?.price?.recurring?.interval
      ?? null;
    const interval = recurringInterval === "year" ? "annual" : "monthly";

    events.push({
      amount: (invoiceData.amount_paid ?? 0) / 100,
      email,
      label: `${getPlanLabel(plan)} ${interval === "annual" ? "Annual" : "Monthly"}`,
    });
  }

  return events;
}

function normalizeStripeReference(value: string | { id: string } | null | undefined) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

function resolveRevenueEventEmail(input: {
  userId: string | null;
  fallbackEmail: string | null;
  emailIndex: Map<string, string>;
}): string | null {
  const indexedEmail = input.userId ? input.emailIndex.get(input.userId) : null;
  const fallbackEmail = input.fallbackEmail?.trim().toLowerCase() ?? null;
  return indexedEmail ?? fallbackEmail;
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

function getTimeBasedSignupEasterEgg(now = new Date()): string | null {
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

function buildSampietroPanicEmbed(email: string): DiscordEmbed | null {
  const normalized = email.toLowerCase();
  if (!normalized.includes("sampietro")) {
    return null;
  }

  return createEmbed({
    title: "🚨 CODICE ROSSO",
    description: "Una Sampietro si e iscritta. Giulia, respira. Probabilmente non e lei. ...Probabilmente.",
    color: COLOR.RED,
  });
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

function getPlanWeight(plan: PlanId): number {
  switch (plan) {
    case "enterprise":
      return 4;
    case "pro":
      return 3;
    case "starter":
      return 2;
    case "free":
    default:
      return 1;
  }
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
  minute: number;
  weekday: string;
  isoDate: string;
  timeLabel: string;
} {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: CUSTOMERS_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number.parseInt(partMap.hour ?? "0", 10);
  const minuteLabel = partMap.minute ?? "00";
  const minute = Number.parseInt(minuteLabel, 10);

  return {
    hour,
    minute,
    weekday: partMap.weekday ?? "",
    isoDate: `${partMap.year ?? "0000"}-${partMap.month ?? "01"}-${partMap.day ?? "01"}`,
    timeLabel: `${partMap.hour ?? "00"}:${minuteLabel} ${CUSTOMERS_TIMEZONE}`,
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

function sumAmounts(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
