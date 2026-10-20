import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo, useApi, useEvents } from '../lib/api';
import { Empty, Loading, useToast } from './ui';

interface ReviewItem {
  id: string;
  title: string;
  status: 'processed' | 'needs_review';
  created_at: string;
  client_id: string;
  client_name: string;
  staff_name: string | null;
  open_findings: number;
  urgent_findings: number;
}

/** Reports that no clinician has signed off yet. "Mine" shows only patients routed to the signed-in doctor. */
export function ReviewQueue({ readOnly }: { readOnly: boolean }) {
  const toast = useToast();
  const [mine, setMine] = useState(false);
  const list = useApi<ReviewItem[]>(`/api/visits/reviews${mine ? '?mine=1' : ''}`);
  useEvents({ 'reviews.updated': () => void list.reload(), 'records.updated': () => void list.reload() });

  const markReviewed = async (id: string) => {
    try {
      await api(`/api/visits/records/${id}/reviewed`, { body: {} });
      toast('Marked as reviewed');
      await list.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const items = list.data ?? [];
  return (
    <div className="card pad stack">
      <div className="row between wrap">
        <h3>Reports awaiting review ({items.length})</h3>
        <div className="row" style={{ gap: 4 }}>
          <button className={`btn sm ${!mine ? 'primary' : 'ghost'}`} onClick={() => setMine(false)}>All</button>
          <button className={`btn sm ${mine ? 'primary' : 'ghost'}`} onClick={() => setMine(true)}>Assigned to me</button>
        </div>
      </div>
      {list.loading && !list.data ? <Loading /> : !items.length ? (
        <Empty icon="📄" title={mine ? 'No reports assigned to you' : 'Every report has been reviewed'} />
      ) : (
        items.map((r) => (
          <div key={r.id} className="row between wrap review-item" style={{ gap: 8 }}>
            <div className="stack" style={{ gap: 2 }}>
              <span>
                <Link to={`/app/clients/${r.client_id}`}><strong>{r.client_name}</strong></Link> · {r.title}
              </span>
              <span className="small muted">
                {r.staff_name ? `For ${r.staff_name}` : 'No doctor assigned'} · {timeAgo(r.created_at)}
                {r.status === 'needs_review' && ' · unreadable file, enter values manually'}
              </span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {r.urgent_findings > 0 && <span className="badge bad">{r.urgent_findings} urgent</span>}
              {r.open_findings > 0 && <span className="badge warn">{r.open_findings} findings</span>}
              {!readOnly && <button className="btn sm" onClick={() => markReviewed(r.id)}>Mark reviewed</button>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/** Count for badges and the home screen. */
export function useReviewCount() {
  const c = useApi<{ all: number; mine: number }>('/api/visits/reviews/count');
  useEvents({ 'reviews.updated': () => void c.reload(), 'records.updated': () => void c.reload() });
  return c.data;
}
