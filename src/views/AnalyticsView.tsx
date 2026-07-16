
import { useEffect, useState, useCallback } from 'react';
import { BarChart3, Clock, TrendingUp, Calendar, AlertCircle } from 'lucide-react';
import { posts, postTime, metrics } from '../lib/db';
import type { SocialPost, SocialPostMetric } from '../types';
import { Badge, EmptyState, SectionHeader } from '../components/ui';
import { formatDate } from '../lib/format';

interface PostWithMeta {
  post: SocialPost;
  totalMinutes: number;
  latestMetric: SocialPostMetric | null;
  engagement: number;
  impressions: number;
}

interface PlatformStats {
  platform: string;
  posts: number;
  published: number;
  impressions: number;
  engagement: number;
  minutes: number;
  engRate: number;
  engagementPerPost: number;
  publishRate: number;
}

export function AnalyticsView() {
  const [data, setData] = useState<PostWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const allPosts = await posts.list();

      const result: PostWithMeta[] = await Promise.all(
        allPosts.map(async (p) => {
          const [times, mets] = await Promise.all([
            postTime.listByPost(p.id),
            metrics.listByPost(p.id),
          ]);

          const sorted = [...mets].sort((a, b) =>
            b.snapshot_date.localeCompare(a.snapshot_date)
          );
          const latest = sorted[0] || null;

          const eng = latest
            ? (latest.likes + latest.comments + latest.shares + latest.saves)
            : 0;

          const imp = latest
            ? (latest.impressions || latest.reach || 0)
            : 0;

          return {
            post: p,
            totalMinutes: times.reduce((s, t) => s + t.minutes, 0),
            latestMetric: latest,
            engagement: eng,
            impressions: imp,
          };
        })
      );

      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Laden der Analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const withMetrics = data.filter(d => d.latestMetric !== null);
  const published = data.filter(d => d.post.status === 'published');
  const scheduled = data.filter(d => Boolean(d.post.scheduled_date));
  const publishedOnSchedule = scheduled.filter(d => d.post.status === 'published');
  const openScheduled = scheduled.filter(d => d.post.status !== 'published');

  const consistencyPct = scheduled.length > 0
    ? Math.round((publishedOnSchedule.length / scheduled.length) * 100)
    : 0;

  const platformMap = new Map<string, {
    posts: number;
    published: number;
    impressions: number;
    engagement: number;
    minutes: number;
  }>();

  for (const d of data) {
    const key = d.post.platform;
    const cur = platformMap.get(key) || {
      posts: 0,
      published: 0,
      impressions: 0,
      engagement: 0,
      minutes: 0,
    };

    cur.posts += 1;
    cur.minutes += d.totalMinutes;

    if (d.post.status === 'published') {
      cur.published += 1;
    }

    if (d.latestMetric) {
      cur.impressions += d.impressions;
      cur.engagement += d.engagement;
    }

    platformMap.set(key, cur);
  }

  const platformStats: PlatformStats[] = Array.from(platformMap.entries())
    .map(([platform, v]) => ({
      platform,
      posts: v.posts,
      published: v.published,
      impressions: v.impressions,
      engagement: v.engagement,
      minutes: v.minutes,
      engRate: v.impressions > 0 ? (v.engagement / v.impressions) * 100 : 0,
      engagementPerPost: v.posts > 0 ? v.engagement / v.posts : 0,
      publishRate: v.posts > 0 ? (v.published / v.posts) * 100 : 0,
    }))
    .sort((a, b) => b.engagement - a.engagement);

  const top3 = [...withMetrics]
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 3);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900 font-semibold">
            Freizeit-Analyse
          </h1>
          <p className="text-sm text-ink-500 mt-0.5">
            Daten werden geladen...
          </p>
        </div>
        <div className="card p-5">
          <EmptyState icon={<BarChart3 size={24} />} title="Analytics laden" hint="Bitte kurz warten." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900 font-semibold">
            Freizeit-Analyse
          </h1>
        </div>
        <div className="card p-5">
          <EmptyState icon={<AlertCircle size={24} />} title="Fehler beim Laden" hint={error} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-medium text-ink-900 font-semibold">
          Freizeit-Analyse
        </h1>
        <p className="text-sm text-ink-500 mt-0.5">
          Aktivitäts-Vergleich · Top-Aktivitäten · Dranbleiben
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatBox label="Aktivitäten gesamt" value={data.length} tone="neutral" />
        <StatBox label="Erledigt" value={published.length} tone="success" />
        <StatBox label="Bewertet" value={withMetrics.length} tone="accent" />
        <StatBox label="Dranbleiben" value={consistencyPct} tone={consistencyPct >= 80 ? 'success' : consistencyPct >= 50 ? 'warning' : 'neutral'} suffix="%" />
      </div>

      <div className="card p-5">
        <SectionHeader title="Aktivitäts-Vergleich" />

        {platformStats.length === 0 ? (
          <EmptyState
            icon={<BarChart3 size={24} />}
            title="Noch keine Bewertungen"
            hint="Bewerte deine Freizeit-Aktivitäten mit einem Spaßfaktor, um hier Auswertungen zu sehen."
          />
        ) : (
          <div className="space-y-3 mt-2">
            {platformStats.map(s => {
              const maxImp = Math.max(...platformStats.map(x => x.impressions), 1);

              return (
                <div key={s.platform} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink-900 capitalize">
                        {s.platform}
                      </span>
                      <span className="text-2xs text-ink-400">
                        {s.posts} Mal
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-right">
                      <div>
                        <p className="text-2xs text-ink-400">Spaßfaktor / Score</p>
                        <p className="text-sm font-medium text-ink-900 tabular-nums">
                          {s.engagement.toLocaleString('de-DE')}
                        </p>
                      </div>

                      <div>
                        <p className="text-2xs text-ink-400">Wiederholungen</p>
                        <Badge tone={s.engRate >= 5 ? 'success' : s.engRate >= 2 ? 'warning' : 'neutral'}>
                          {s.impressions.toLocaleString('de-DE')}
                        </Badge>
                      </div>

                      <div>
                        <p className="text-2xs text-ink-400">Erledigt</p>
                        <p className="text-sm font-medium text-ink-900 tabular-nums">
                          {s.published}
                        </p>
                      </div>

                      <div>
                        <p className="text-2xs text-ink-400">Aufwand</p>
                        <p className="text-sm font-medium text-ink-900 tabular-nums">
                          {s.minutes} min
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="h-1.5 rounded-full bg-surfaceMuted overflow-hidden">
                    <div
                      className="h-full bg-accent-500 rounded-full transition-all duration-500"
                      style={{ width: `${maxImp > 0 ? (s.impressions / maxImp) * 100 : 0}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap gap-3 text-2xs text-ink-500">
                    <span>Ø Spaßfaktor: {s.engagementPerPost.toFixed(1)}</span>
                    <span>Erledigungs-Rate: {s.publishRate.toFixed(0)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card p-5">
        <SectionHeader title="Die besten Aktivitäten" />

        {top3.length === 0 ? (
          <EmptyState
            icon={<TrendingUp size={24} />}
            title="Keine bewerteten Aktivitäten"
            hint="Vergib einen Score für deine erledigten Freizeitaktivitäten."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
            {top3.map((d, i) => (
              <div key={d.post.id} className="p-4 rounded-xl bg-surfaceAlt/50 border border-line space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold tabular-nums ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : 'text-amber-700'}`}>
                      #{i + 1}
                    </span>
                    <Badge tone="neutral">{d.post.platform}</Badge>
                  </div>
                </div>

                <p className="text-sm font-medium text-ink-900 line-clamp-2">
                  {d.post.topic || '(kein Thema)'}
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Spaßfaktor" value={String(d.engagement)} tone="success" />
                  <Metric label="Wiederholungen" value={d.impressions.toLocaleString('de-DE')} tone="accent" />
                  <Metric
                    label="Score / Mal"
                    value={d.impressions > 0 ? `${(d.engagement / d.impressions * 100).toFixed(1)}` : '—'}
                    tone="neutral"
                  />
                  <Metric
                    label="Dauer"
                    value={d.totalMinutes > 0 ? `${d.totalMinutes} min` : '—'}
                    tone="neutral"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={18} className="text-accent-600" />
          <h2 className="section-title">Konsistenz & Dranbleiben</h2>
        </div>

        {scheduled.length === 0 ? (
          <EmptyState
            icon={<Calendar size={24} />}
            title="Nichts geplant"
            hint="Plane Aktivitäten im Voraus, um dranzubleiben."
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <StatBox label="Geplant" value={scheduled.length} tone="neutral" />
              <StatBox label="Erledigt" value={publishedOnSchedule.length} tone="success" />
              <StatBox
                label="Noch offen"
                value={openScheduled.length}
                tone={openScheduled.length > 0 ? 'warning' : 'neutral'}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-ink-700">Zielerreichung (Dranbleiben)</span>
                <span className="text-sm font-semibold text-ink-900 tabular-nums">
                  {consistencyPct}%
                </span>
              </div>

              <div className="h-2.5 rounded-full bg-surfaceMuted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    consistencyPct >= 80
                      ? 'bg-success-500'
                      : consistencyPct >= 50
                      ? 'bg-warning-400'
                      : 'bg-danger-400'
                  }`}
                  style={{ width: `${consistencyPct}%` }}
                />
              </div>
            </div>

            {openScheduled.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-2xs font-semibold uppercase text-ink-400 tracking-wider">
                  Steht noch an
                </p>

                {openScheduled.slice(0, 5).map(d => (
                  <div key={d.post.id} className="flex items-center gap-2 text-sm text-ink-600">
                    <AlertCircle size={13} className="text-warning-500 shrink-0" />
                    <span className="truncate">{d.post.topic || d.post.platform}</span>
                    <span className="text-2xs text-ink-400 shrink-0">
                      {d.post.scheduled_date}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'accent' | 'success' | 'neutral' }) {
  const color = tone === 'accent' ? 'text-accent-700' : tone === 'success' ? 'text-success-700' : 'text-ink-700';
  return (
    <div>
      <p className="text-2xs text-ink-400">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="text-2xs text-ink-400">{label}</p>
      <p className="text-xs font-medium text-ink-700 tabular-nums">{value ?? '—'}</p>
    </div>
  );
}

function StatBox({
  label,
  value,
  tone,
  suffix = '',
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'success' | 'warning' | 'accent';
  suffix?: string;
}) {
  const color = tone === 'success' ? 'text-success-700' : tone === 'warning' ? 'text-warning-600' : tone === 'accent' ? 'text-accent-700' : 'text-ink-700';
  return (
    <div className="text-center p-3 rounded-lg bg-surfaceAlt/50">
      <p className="text-2xs text-ink-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold mt-1 tabular-nums ${color}`}>
        {value}{suffix}
      </p>
    </div>
  );
}
