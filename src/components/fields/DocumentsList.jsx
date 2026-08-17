import { FileText } from "lucide-react";

// Sibling of RecordingsList — same filter/empty-state rule (a blank url
// never renders, no placeholder text for an empty list). FileText instead
// of ExternalLink so a documents chip reads differently from a recordings
// chip at a glance; visually otherwise identical (reuses .recording-link/
// .recordings-list — see DocumentsEditor's header comment on why this
// wasn't generalized into shared components this pass).
export function DocumentsList({ documents }) {
  const valid = (documents || []).filter((d) => d.url && d.url.trim());
  if (valid.length === 0) return null;
  return (
    <div className="recordings-list">
      {valid.map((d) => (
        <a key={d.id} className="recording-link" href={d.url} target="_blank" rel="noopener noreferrer">
          <FileText size={13} />
          {d.label && d.label.trim() ? d.label : d.url}
        </a>
      ))}
    </div>
  );
}
