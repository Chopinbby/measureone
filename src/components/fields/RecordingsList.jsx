import { ExternalLink } from "lucide-react";

export function RecordingsList({ recordings }) {
  const valid = (recordings || []).filter((r) => r.url && r.url.trim());
  if (valid.length === 0) return null;
  return (
    <div className="recordings-list">
      {valid.map((r) => (
        <a key={r.id} className="recording-link" href={r.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={13} />
          {r.label && r.label.trim() ? r.label : r.url}
        </a>
      ))}
    </div>
  );
}
