import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Trash2, Calendar, ChevronLeft, ChevronRight,
  Video, Image, FileText, Clock, Search, Filter, X
} from 'lucide-react';
import { posts, postAssets, postTime, metrics, projects, uuid, getPlatforms, getFormats } from '../lib/db';
import type { SocialPost, Project, PostStatus, SocialPostMetric } from '../types';
import { formatDate, todayISO, formatDuration, startOfWeek } from '../lib/format';
import { Badge, EmptyState, Field, Modal, SectionHeader } from '../components/ui';

const STATUS_LABELS: Record<PostStatus, string> = {
  idea: 'Idee', in_progress: 'In Arbeit', ready: 'Bereit', published: 'Veröffentlicht',
};
const STATUS_TONE: Record<PostStatus, 'neutral' | 'accent' | 'info' | 'success'> = {
  idea: 'neutral', in_progress: 'accent', ready: 'info', published: 'success',
};

// Hilfsfunktion für lokale ISO-Daten (verhindert Off-by-one Fehler durch Zeitzonen)
function toLocalISO(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function PlatformIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase();
  if (p.includes('instagram')) return <Image size={13} />;
  if (p.includes('linkedin')) return <FileText size={13} />;
  if (p.includes('tiktok') || p.includes('youtube')) return <Video size={13} />;
  return <FileText size={13} />;
}

function FormatIcon({ format }: { format: string }) {
  const f = format.toLowerCase();
  if (f.includes('reel') || f.includes('story') || f.includes('video') || f.includes('short')) return <Video size={13} />;
  if (f.includes('carousel') || f.includes('image')) return <Image size={13} />;
  return <FileText size={13} />;
}

export function SocialView() {
  const [list, setList] = useState<SocialPost[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [view, setView] = useState<'week' | 'month' | 'list'>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<SocialPost | null>(null);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [formats, setFormats] = useState<string[]>([]);

  // Filter States für die Listenansicht
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setList(await posts.list());
    setProjectList(await projects.list());
    setPlatforms(await getPlatforms());
    setFormats(await getFormats());
  }, []);

  useEffect(() => { load(); }, [load]);

  // Logik für die gefilterte Liste
  const filteredList = list.filter(p => {
    const matchesSearch = (p.topic || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchesPlatform = platformFilter === 'all' || p.platform === platformFilter;
    return matchesSearch && matchesStatus && matchesPlatform;
  });

  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + weekOffset * 7);
  const weekStart = startOfWeek(baseDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const postsByDate: Record<string, SocialPost[]> = {};
  list.forEach(p => {
    if (p.scheduled_date) {
      (postsByDate[p.scheduled_date] = postsByDate[p.scheduled_date] || []).push(p);
    }
  });
  const unscheduled = list.filter(p => !p.scheduled_date);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">Social Planer</h1>
          <p className="text-sm text-ink-500 mt-0.5">{list.length} Posts · {list.filter(p => p.status === 'published').length} veröffentlicht</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-surfaceMuted rounded-lg p-0.5">
            <button onClick={() => setView('week')} className={`px-3 py-1.5 rounded-md text-sm ${view === 'week' ? 'bg-surface shadow-soft text-ink-900' : 'text-ink-500'}`}>Woche</button>
            <button onClick={() => setView('month')} className={`px-3 py-1.5 rounded-md text-sm ${view === 'month' ? 'bg-surface shadow-soft text-ink-900' : 'text-ink-500'}`}>Monat</button>
            <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-md text-sm ${view === 'list' ? 'bg-surface shadow-soft text-ink-900' : 'text-ink-500'}`}>Liste</button>
          </div>
          <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus size={16} /> Neuer Post</button>
        </div>
      </div>

      {view === 'week' && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekOffset(w => w - 1)} className="p-1.5 rounded-lg hover:bg-surfaceAlt"><ChevronLeft size={18} /></button>
              <button onClick={() => setWeekOffset(0)} className="btn-ghost text-sm">Heute</button>
              <button onClick={() => setWeekOffset(w => w + 1)} className="p-1.5 rounded-lg hover:bg-surfaceAlt"><ChevronRight size={18} /></button>
            </div>
            <p className="text-sm font-medium text-ink-900">
              {formatDate(toLocalISO(weekStart))} – {formatDate(toLocalISO(weekDays[6]))}
            </p>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {weekDays.map(d => {
              const iso = toLocalISO(d);
              const isToday = iso === todayISO();
              const dayPosts = postsByDate[iso] || [];
              return (
                <div key={iso} className={`min-h-[120px] p-2 rounded-lg border ${isToday ? 'border-accent-300 bg-accent-50/30' : 'border-line bg-surfaceAlt/30'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-2xs font-semibold ${isToday ? 'text-accent-700' : 'text-ink-500'}`}>
                      {d.toLocaleDateString('de-DE', { weekday: 'short' })}
                    </span>
                    <span className={`text-2xs tabular-nums ${isToday ? 'text-accent-700 font-semibold' : 'text-ink-400'}`}>{d.getDate()}</span>
                  </div>
                  <div className="space-y-1">
                    {dayPosts.map(p => (
                      <button key={p.id} onClick={() => setSelected(p)} className="w-full text-left px-2 py-1.5 rounded-md bg-surface border border-line hover:border-accent-200 transition-colors">
                        <div className="flex items-center gap-1.5">
                          <span className="text-ink-400"><PlatformIcon platform={p.platform} /></span>
                          <span className="text-2xs font-medium text-ink-900 truncate flex-1">{p.topic || 'Unbenannt'}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          <span className="text-ink-400"><FormatIcon format={p.format} /></span>
                          <span className={`w-1.5 h-1.5 rounded-full ${p.status === 'published' ? 'bg-success-500' : p.status === 'ready' ? 'bg-info-500' : p.status === 'in_progress' ? 'bg-accent-500' : 'bg-ink-300'}`} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {unscheduled.length > 0 && (
            <div className="mt-5">
              <SectionHeader title="Nicht geplante Posts" />
              <div className="flex flex-wrap gap-2">
                {unscheduled.map(p => (
                  <button key={p.id} onClick={() => setSelected(p)} className="chip bg-surfaceMuted hover:bg-line text-ink-700">
                    <PlatformIcon platform={p.platform} /> {p.topic || 'Unbenannt'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'month' && (
        <MonthView postsByDate={postsByDate} monthOffset={monthOffset} setMonthOffset={setMonthOffset} onSelect={setSelected} unscheduled={unscheduled} />
      )}

      {view === 'list' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="card p-4 flex flex-wrap items-center gap-4 bg-surface shadow-sm">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                type="text"
                placeholder="Post-Thema suchen..."
                className="input pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600">
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Filter size={14} className="text-ink-400" />
              <select 
                className="input !py-1.5 text-xs w-auto"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">Alle Status</option>
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>

              <select 
                className="input !py-1.5 text-xs w-auto"
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
              >
                <option value="all">Alle Plattformen</option>
                {platforms.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Table / List */}
          <div className="card p-5">
            <SectionHeader title="Gefilterte Posts" />
            {filteredList.length === 0 ? (
              <EmptyState icon={<Search size={24} />} title="Keine Ergebnisse" hint="Passe deine Filter an oder starte eine neue Suche." />
            ) : (
              <div className="divide-y divide-line">
                {filteredList.map(p => (
                  <button key={p.id} onClick={() => setSelected(p)} className="w-full flex items-center gap-3 py-3 text-left hover:bg-surfaceAlt/40 px-2 rounded-lg transition-colors">
                    <div className="w-9 h-9 rounded-lg bg-surfaceMuted flex items-center justify-center text-ink-500">
                      <PlatformIcon platform={p.platform} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-900 truncate">{p.topic || 'Unbenannt'}</p>
                      <p className="text-2xs text-ink-500">
                        <span className="font-semibold text-accent-600 uppercase">{p.platform}</span>
                        {p.scheduled_date ? ` · Geplant für ${formatDate(p.scheduled_date)}` : ' · Ohne Termin'}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABELS[p.status]}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selected && <PostDetailModal post={selected} projects={projectList} onClose={() => { setSelected(null); load(); }} />}
      <AddPostModal open={showAdd} onClose={() => setShowAdd(false)} projects={projectList} onAdded={load} platforms={platforms} formats={formats} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------

function MonthView({ postsByDate, monthOffset, setMonthOffset, onSelect, unscheduled }: {
  postsByDate: Record<string, SocialPost[]>;
  monthOffset: number;
  setMonthOffset: React.Dispatch<React.SetStateAction<number>>;
  onSelect: (p: SocialPost) => void;
  unscheduled: SocialPost[];
}) {
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear();
  const month = base.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const daysInMonth = monthEnd.getDate();
  const leading = (monthStart.getDay() + 6) % 7;
  const cells: (Date | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const monthName = base.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const weekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setMonthOffset(w => w - 1)} className="p-1.5 rounded-lg hover:bg-surfaceAlt"><ChevronLeft size={18} /></button>
          <button onClick={() => setMonthOffset(0)} className="btn-ghost text-sm">Heute</button>
          <button onClick={() => setMonthOffset(w => w + 1)} className="p-1.5 rounded-lg hover:bg-surfaceAlt"><ChevronRight size={18} /></button>
        </div>
        <p className="text-sm font-medium text-ink-900">{monthName}</p>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekdays.map(d => <div key={d} className="text-center text-2xs font-semibold uppercase tracking-wider text-ink-400 py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="min-h-[80px] rounded-lg bg-surfaceAlt/20" />;
          const iso = toLocalISO(d);
          const isToday = iso === todayISO();
          const dayPosts = postsByDate[iso] || [];
          return (
            <div key={i} className={`min-h-[80px] p-1.5 rounded-lg border ${isToday ? 'border-accent-300 bg-accent-50/30' : 'border-line bg-surfaceAlt/20'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-2xs tabular-nums ${isToday ? 'text-accent-700 font-semibold' : 'text-ink-500'}`}>{d.getDate()}</span>
                {dayPosts.length > 0 && <span className="text-2xs text-ink-400">{dayPosts.length}</span>}
              </div>
              <div className="space-y-0.5">
                {dayPosts.slice(0, 3).map(p => (
                  <button key={p.id} onClick={() => onSelect(p)} className="w-full text-left px-1.5 py-1 rounded bg-surface border border-line hover:border-accent-200 transition-colors">
                    <div className="flex items-center gap-1">
                      <span className="text-ink-400 shrink-0"><PlatformIcon platform={p.platform} /></span>
                      <span className="text-2xs text-ink-900 truncate">{p.topic || 'Unbenannt'}</span>
                    </div>
                  </button>
                ))}
                {dayPosts.length > 3 && <p className="text-2xs text-ink-400 px-1">+{dayPosts.length - 3} weitere</p>}
              </div>
            </div>
          );
        })}
      </div>
      {unscheduled.length > 0 && (
        <div className="mt-5">
          <SectionHeader title="Nicht geplante Posts" />
          <div className="flex flex-wrap gap-2">
            {unscheduled.map(p => (
              <button key={p.id} onClick={() => onSelect(p)} className="chip bg-surfaceMuted hover:bg-line text-ink-700">
                <PlatformIcon platform={p.platform} /> {p.topic || 'Unbenannt'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post detail modal
// ---------------------------------------------------------------------------

function PostDetailModal({ post, projects, onClose }: {
  post: SocialPost; projects: Project[]; onClose: () => void;
}) {
  const [topic, setTopic] = useState(post.topic || '');
  const [caption, setCaption] = useState(post.caption || '');
  const [status, setStatus] = useState<PostStatus>(post.status);
  const [scheduled, setScheduled] = useState(post.scheduled_date || '');
  const [projectId, setProjectId] = useState(post.project_id || '');
  const [assetList, setAssetList] = useState<{ id: string; label: string; value: string; type: string }[]>([]);
  const [timeList, setTimeList] = useState<{ id: string; minutes: number; entry_date: string; note: string | null }[]>([]);
  const [newAssetLabel, setNewAssetLabel] = useState('');
  const [newAssetValue, setNewAssetValue] = useState('');
  const [newMinutes, setNewMinutes] = useState('');
  const [metricList, setMetricList] = useState<SocialPostMetric[]>([]);
  const [showMetrics, setShowMetrics] = useState(false);

  useEffect(() => {
    (async () => {
      setAssetList(await postAssets.listByPost(post.id) as never);
      setTimeList(await postTime.listByPost(post.id) as never);
      setMetricList(await metrics.listByPost(post.id));
    })();
  }, [post.id]);

  async function save() {
    const publishedDate = status === 'published' 
      ? (post.published_date || todayISO()) 
      : null;

    await posts.update(post.id, {
      topic: topic || null, 
      caption: caption || null, 
      status,
      scheduled_date: scheduled || null, 
      project_id: projectId || null,
      published_date: publishedDate,
    });
    onClose();
  }

  async function addAsset() {
    if (!newAssetLabel.trim() || !newAssetValue.trim()) return;
    const id = await uuid();
    await postAssets.insert({ id, post_id: post.id, type: 'link', label: newAssetLabel.trim(), value: newAssetValue.trim(), created_at: new Date().toISOString() });
    setNewAssetLabel(''); setNewAssetValue('');
    setAssetList(await postAssets.listByPost(post.id) as never);
  }

  async function removeAsset(id: string) {
    await postAssets.remove(id);
    setAssetList(await postAssets.listByPost(post.id) as never);
  }

  async function addTime() {
    const mins = parseInt(newMinutes);
    if (!mins || mins <= 0) return;
    const id = await uuid();
    await postTime.insert({ id, post_id: post.id, minutes: mins, entry_date: todayISO(), note: null, created_at: new Date().toISOString() });
    setNewMinutes('');
    setTimeList(await postTime.listByPost(post.id) as never);
  }

  async function removeTime(id: string) {
    await postTime.remove(id);
    setTimeList(await postTime.listByPost(post.id) as never);
  }

  async function deletePost() {
    if (!confirm('Post wirklich löschen?')) return;

    const assets = await postAssets.listByPost(post.id);
    const times = await postTime.listByPost(post.id);
    const m = await metrics.listByPost(post.id);

    await Promise.all([
      ...assets.map(a => postAssets.remove(a.id)),
      ...times.map(t => postTime.remove(t.id)),
      ...m.map(x => metrics.remove(x.id)),
    ]);

    await posts.remove(post.id);
    onClose();
  }

  const totalTime = timeList.reduce((s, t) => s + t.minutes, 0);

  return (
  <Modal
    open={true}
    onClose={onClose}
    title="Post bearbeiten"
    size="lg"
    footer={
      <>
        <button onClick={onClose} className="btn-ghost">
          Abbrechen
        </button>
        <button onClick={save} className="btn-primary">
          Speichern
        </button>
        <button onClick={deletePost} className="btn-danger">
          Löschen
        </button>
      </>
    }
  >
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Thema">
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </Field>
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as PostStatus)}>
            {(['idea', 'in_progress', 'ready', 'published'] as PostStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Geplant am">
          <input type="date" className="input" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
        </Field>
        <Field label="Projekt (optional)">
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— Kein Projekt —</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Caption">
        <textarea
          className="input min-h-[100px] resize-y"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
      </Field>

      <div>
        <p className="label">Assets</p>
        <div className="space-y-1.5 mb-2">
          {assetList.map(a => (
            <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surfaceAlt/50 text-sm">
              <span className="flex-1 truncate">{a.label}</span>
              <a
                href={a.value}
                target="_blank"
                rel="noreferrer"
                className="text-2xs text-accent-600 hover:underline truncate max-w-[150px]"
              >
                {a.value}
              </a>
              <button onClick={() => removeAsset(a.id)} className="p-1 text-ink-400 hover:text-danger-600">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1 text-sm"
            placeholder="Bezeichnung"
            value={newAssetLabel}
            onChange={(e) => setNewAssetLabel(e.target.value)}
          />
          <input
            className="input flex-1 text-sm"
            placeholder="URL"
            value={newAssetValue}
            onChange={(e) => setNewAssetValue(e.target.value)}
          />
          <button onClick={addAsset} className="btn-ghost text-sm">
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="label !mb-0">Zeiterfassung</p>
          <span className="text-2xs text-ink-500 tabular-nums">{formatDuration(totalTime)}</span>
        </div>
        <div className="space-y-1.5 mb-2">
          {timeList.map(t => (
            <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surfaceAlt/50 text-sm">
              <Clock size={13} className="text-ink-400" />
              <span className="flex-1 text-ink-700">{formatDate(t.entry_date)}</span>
              <span className="tabular-nums text-ink-700">{formatDuration(t.minutes)}</span>
              <button onClick={() => removeTime(t.id)} className="p-1 text-ink-400 hover:text-danger-600">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            className="input flex-1 text-sm"
            placeholder="Minuten"
            value={newMinutes}
            onChange={(e) => setNewMinutes(e.target.value)}
          />
          <button onClick={addTime} className="btn-ghost text-sm">
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="label !mb-0">Performance-Snapshots</p>
          <button onClick={() => setShowMetrics(s => !s)} className="text-2xs text-accent-600 hover:text-accent-700">
            {showMetrics ? 'Schließen' : '+ Snapshot'}
          </button>
        </div>

        {metricList.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {metricList.map(m => (
              <div key={m.id} className="px-3 py-2 rounded-lg bg-surfaceAlt/50 text-sm group">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-2xs text-ink-500">{formatDate(m.snapshot_date)}</span>
                  <button
                    onClick={() => metrics.remove(m.id).then(() => metrics.listByPost(post.id).then(setMetricList))}
                    className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-2xs text-ink-700">
                  {m.reach > 0 && <span>Reichweite: <b className="tabular-nums">{m.reach.toLocaleString('de-DE')}</b></span>}
                  {m.likes > 0 && <span>Likes: <b className="tabular-nums">{m.likes}</b></span>}
                  {m.comments > 0 && <span>Kommentare: <b className="tabular-nums">{m.comments}</b></span>}
                  {m.shares > 0 && <span>Shares: <b className="tabular-nums">{m.shares}</b></span>}
                  {m.saves > 0 && <span>Saves: <b className="tabular-nums">{m.saves}</b></span>}
                  {m.clicks > 0 && <span>Klicks: <b className="tabular-nums">{m.clicks}</b></span>}
                  {m.impressions > 0 && <span>Impressionen: <b className="tabular-nums">{m.impressions.toLocaleString('de-DE')}</b></span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {showMetrics && <MetricForm postId={post.id} onSaved={() => metrics.listByPost(post.id).then(setMetricList)} />}
      </div>
    </div>
  </Modal>
);
}

// ---------------------------------------------------------------------------
// Add post modal
// ---------------------------------------------------------------------------

function AddPostModal({ open, onClose, projects, onAdded, platforms, formats }: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  onAdded: () => void;
  platforms: string[];
  formats: string[];
}) {
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState('');
  const [format, setFormat] = useState('');
  const [scheduled, setScheduled] = useState('');
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);

  // Felder zurücksetzen, sobald das Modal erneut geöffnet wird
  useEffect(() => {
    if (open) {
      setTopic('');
      setPlatform(platforms[0] || '');
      setFormat(formats[0] || '');
      setScheduled('');
      setProjectId('');
    }
  }, [open, platforms, formats]);

  if (!open) return null;

  async function create() {
    if (!platform || !format) return;
    setSaving(true);
    try {
      const id = await uuid();
      await posts.insert({
        id,
        topic: topic || null,
        caption: null,
        platform,
        format,
        status: 'idea' as PostStatus,
        scheduled_date: scheduled || null,
        published_date: null,
        project_id: projectId || null,
        created_at: new Date().toISOString(),
      });
      onAdded();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Neuer Post"
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Abbrechen
          </button>
          <button onClick={create} disabled={saving || !platform || !format} className="btn-primary">
            {saving ? 'Speichere…' : 'Anlegen'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Thema">
          <input
            className="input"
            placeholder="Worum geht's in dem Post?"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Plattform">
            <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">— Wählen —</option>
              {platforms.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Format">
            <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="">— Wählen —</option>
              {formats.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Geplant am (optional)">
            <input type="date" className="input" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
          </Field>
          <Field label="Projekt (optional)">
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Kein Projekt —</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Metric form (Performance-Snapshot für einen Post)
// ---------------------------------------------------------------------------

function MetricForm({ postId, onSaved }: { postId: string; onSaved: () => void }) {
  const [reach, setReach] = useState('');
  const [likes, setLikes] = useState('');
  const [comments, setComments] = useState('');
  const [shares, setShares] = useState('');
  const [saves, setSaves] = useState('');
  const [clicks, setClicks] = useState('');
  const [impressions, setImpressions] = useState('');
  const [saving, setSaving] = useState(false);

  const num = (v: string) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  async function save() {
    setSaving(true);
    try {
      const id = await uuid();
      await metrics.insert({
        id,
        post_id: postId,
        snapshot_date: todayISO(),
        reach: num(reach),
        likes: num(likes),
        comments: num(comments),
        shares: num(shares),
        saves: num(saves),
        clicks: num(clicks),
        impressions: num(impressions),
        created_at: new Date().toISOString(),
      });
      setReach(''); setLikes(''); setComments('');
      setShares(''); setSaves(''); setClicks(''); setImpressions('');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-3 rounded-lg border border-line bg-surfaceAlt/40 space-y-2 mb-2">
      <div className="grid grid-cols-3 gap-2">
        <input type="number" className="input text-sm" placeholder="Reichweite" value={reach} onChange={(e) => setReach(e.target.value)} />
        <input type="number" className="input text-sm" placeholder="Likes" value={likes} onChange={(e) => setLikes(e.target.value)} />
        <input type="number" className="input text-sm" placeholder="Kommentare" value={comments} onChange={(e) => setComments(e.target.value)} />
        <input type="number" className="input text-sm" placeholder="Shares" value={shares} onChange={(e) => setShares(e.target.value)} />
        <input type="number" className="input text-sm" placeholder="Saves" value={saves} onChange={(e) => setSaves(e.target.value)} />
        <input type="number" className="input text-sm" placeholder="Klicks" value={clicks} onChange={(e) => setClicks(e.target.value)} />
      </div>
      <input type="number" className="input text-sm" placeholder="Impressionen" value={impressions} onChange={(e) => setImpressions(e.target.value)} />
      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary text-sm">
          {saving ? 'Speichere…' : 'Snapshot speichern'}
        </button>
      </div>
    </div>
  );
}
