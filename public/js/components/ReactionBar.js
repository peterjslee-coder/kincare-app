// ─── Reactions, as one thing, for anything (v1.105.158) ───
//
// Pete: "give me the apple overlap. I'd like the option to carry this same thing over to
// people reacting to visits and care notes as well...socialize anywhere that we're leaving
// feedback."
//
// So this component knows nothing about messages. It takes a list of reactions and a callback
// and draws Apple's overlap: a small cluster of pills sitting ON the corner of whatever it
// belongs to, rather than a row of chips pushed underneath it. Anything that can be reacted
// to — a message today, a care note or a visit next — renders the same cluster, because
// "socialize anywhere we're leaving feedback" only works if it looks like one feature rather
// than three that happen to rhyme.
//
// `align` says which corner it hangs off: 'right' for something you sent, 'left' for
// something you're reading. `overlap` false puts it inline instead, for surfaces where a
// floating cluster would collide with the layout — the caller decides, not this file.
const ReactionBar = window.ReactionBar = ({ reactions, onReact, currentUserId, align = 'left', overlap = true }) => {
  const list = Array.isArray(reactions) ? reactions : [];
  if (!list.length) return null;

  // One pill per emoji, with a count when more than one person picked it — the way iMessage
  // stacks them, not one pill per person.
  const grouped = list.reduce((acc, r) => {
    (acc[r.emoji] = acc[r.emoji] || []).push(r);
    return acc;
  }, {});

  const positioned = overlap ? {
    position: 'absolute',
    bottom: -13,
    [align === 'right' ? 'right' : 'left']: 8,
    zIndex: 2,
  } : {
    marginTop: 4,
    display: 'flex',
    justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
  };

  return (
    <div style={{ display: 'flex', gap: 3, ...positioned }}>
      {Object.entries(grouped).map(([emoji, who]) => {
        const mine = who.some((r) => r.userId === currentUserId);
        return (
          <button key={emoji}
            onClick={(e) => { e.stopPropagation(); if (onReact) onReact(emoji); }}
            title={who.map((r) => r.userName).filter(Boolean).join(', ')}
            aria-label={`${emoji} from ${who.map((r) => r.userName).filter(Boolean).join(', ') || 'someone'}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 2,
              padding: '2px 7px',
              // The ring is what makes it read as sitting ON the bubble rather than beside it.
              background: mine ? 'var(--bubble-sent-bg)' : 'var(--bg-elevated, #3b3b3d)',
              border: '2px solid var(--bg-primary)',
              borderRadius: 14,
              fontSize: 13, lineHeight: 1.2, cursor: 'pointer',
              color: mine ? 'var(--text-on-primary)' : 'var(--text-primary)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.28)',
            }}>
            <span aria-hidden="true">{emoji}</span>
            {who.length > 1 && (
              <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.85 }}>{who.length}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
