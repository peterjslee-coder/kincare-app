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

  // ─── v1.105.167 — off the timestamp, and out of its box ───
  //
  // Pete: "The emoji…looks dumb and janky. Needs to not block the time of the message. Also,
  // no box around it."
  //
  // It hung off the BOTTOM corner, which on a sent bubble is exactly where the time and the
  // read receipt live — his screenshot has "10:5..." disappearing behind it. Apple hangs a
  // Tapback off the TOP corner, and the reason is not taste: the bottom of a bubble is
  // already spoken for.
  //
  // The box goes too. A white pill with a ring and a drop shadow is a chip — a piece of UI
  // sitting next to the message. A Tapback is a mark ON the message. The emoji alone, at the
  // size it wants to be, is smaller on the screen than a smaller emoji inside chrome.
  const positioned = overlap ? {
    position: 'absolute',
    top: -12,
    [align === 'right' ? 'right' : 'left']: 10,
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
              display: 'flex', alignItems: 'center', gap: 1,
              padding: 0,
              background: 'none',
              border: 'none',
              fontSize: 15, lineHeight: 1, cursor: 'pointer',
              // One's own reaction is not marked by a different colour any more — there is no
              // fill left to colour. A slight lift is enough, and it survives both themes.
              transform: mine ? 'scale(1.12)' : 'none',
              transformOrigin: align === 'right' ? 'right center' : 'left center',
              // The badge straddles the bubble's edge, so it is over two different colours at
              // once. A shadow rather than a background keeps it legible on both without
              // putting a box back.
              filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))',
            }}>
            <span aria-hidden="true">{emoji}</span>
            {who.length > 1 && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
                // The count is text, not an emoji, so it needs its own legibility against
                // whichever half of the edge it lands on.
                textShadow: '0 0 3px var(--bg-primary), 0 0 3px var(--bg-primary)',
              }}>{who.length}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
