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
// The six the server accepts (src/utils/reactions.js ALLOWED_EMOJIS) and the six the messages
// screen offers. Kept in one place on the client too, so a picker cannot offer an emoji the
// API will reject with "Invalid emoji" after the tap.
const REACTION_EMOJIS = window.REACTION_EMOJIS = ['❤️', '👍', '👎', '😂', '😮', '🙏'];

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
  // Offsets are for the 32px HIT BOX, not the glyph: the emoji is centred in it, so the mark
  // you see lands about 13px above and 4px outside the bubble's corner — overlapping the
  // bubble's padding, never its first line of text. Measured on production at 375x812.
  const positioned = overlap ? {
    position: 'absolute',
    top: -20,
    [align === 'right' ? 'right' : 'left']: -14,
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
              // ─── The "box" was a global rule, not this component's styling ───
              //
              // `@media (max-width: 768px) { .btn, button { min-height: 44px; min-width: 44px } }`
              // in styles.css. It applies to EVERY button on a phone, so a badge holding one
              // 11.5px emoji was rendered as a 44x44 block — which is what Pete photographed
              // as a box, and why it "dominates the message". Shrinking the font could never
              // have fixed it; the size was never coming from the font.
              //
              // 44px is right for a thumb and wrong for a mark on a bubble, and this is a
              // secondary affordance (tap your own reaction to remove it) — the primary way
              // to react is the hold-for-emoji row. 32px is the compromise, and it must be
              // stated explicitly because the broad rule wins otherwise.
              width: 32, height: 32, minWidth: 32, minHeight: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
              padding: 0,
              background: 'none',
              border: 'none',
              fontSize: 17, lineHeight: 1, cursor: 'pointer',
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

// ─── ReactionRow — the whole affordance, for surfaces with no gesture (v1.105.170) ───
//
// Pete: "add the reactions into the notes section."
//
// On a message you react by holding it; a note is not a bubble and has no gesture, so the way
// in has to be visible. ReactionBar above only DISPLAYS — this adds the way to leave one, and
// keeps both halves in the same file so notes, visits and whatever comes next get the same
// thing rather than each growing their own.
//
// Inline rather than overlapped: `overlap` hangs the cluster off a bubble's corner, which on a
// note row lands on the author line or the photo thumbnail. A note is a block of text in a
// list, so the reactions sit under it, on their own line, where nothing else is.
const ReactionRow = window.ReactionRow = ({ reactions, onReact, currentUserId, disabled = false }) => {
  const [picking, setPicking] = React.useState(false);
  const list = Array.isArray(reactions) ? reactions : [];
  const mine = list.find((r) => r.userId === currentUserId);

  const pick = (emoji) => { setPicking(false); if (onReact) onReact(emoji); };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap', position: 'relative' }}
      onClick={(e) => e.stopPropagation()}>
      <ReactionBar reactions={list} currentUserId={currentUserId} onReact={onReact} overlap={false} />

      {!disabled && (
        <button
          onClick={(e) => { e.stopPropagation(); setPicking((p) => !p); }}
          aria-label={mine ? 'Change your reaction' : 'Add a reaction'}
          title={mine ? 'Change your reaction' : 'Add a reaction'}
          style={{
            // Same opt-out as the badge: `@media (max-width:768px) { button { min-height:44px } }`
            // would make this a 44px block in the middle of a note. See ReactionBar above.
            width: 28, height: 28, minWidth: 28, minHeight: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, borderRadius: 999,
            border: '1px dashed var(--border-light, #e0e0e0)',
            background: 'none',
            color: 'var(--text-muted)', fontSize: 15, lineHeight: 1, cursor: 'pointer',
            opacity: 0.65,
          }}>
          {/* ─── v1.105.174 — a control, not a face ───
              Pete, the morning after .170 shipped: "Why does every entry now have the same
              emoji on it". It was a ☺, and he is right twice over. An emoji on a row reads as
              CONTENT — and on a visit row it lands next to the mood emoji from v1.105.164,
              which is content, and means something. Two smileys side by side, one of which is
              a button, is worse than no button.
              A dashed outline with a "+" is unmistakably an affordance. Nothing about it
              claims to be part of the note. */}
          {'\u002B'}
        </button>
      )}

      {picking && (
        <React.Fragment>
          {/* The dismiss layer. v1.105.159 shipped an emoji strip on messages that a tap
              opened and nothing closed — on a touch screen mouseenter fires on tap and
              mouseleave never does. Any surface that opens a picker owes the user a way out
              that is not "choose an emoji you did not want". */}
          <div onClick={(e) => { e.stopPropagation(); setPicking(false); }}
            onTouchStart={(e) => { e.stopPropagation(); setPicking(false); }}
            style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
          <div style={{
            position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, zIndex: 10,
            display: 'flex', gap: 2, padding: '4px 6px', borderRadius: 999,
            background: 'var(--bg-surface)', border: '1px solid var(--border-light, #e0e0e0)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
          }}>
            {REACTION_EMOJIS.map((emoji) => (
              <button key={emoji} onClick={(e) => { e.stopPropagation(); pick(emoji); }}
                aria-label={emoji}
                style={{
                  width: 34, height: 34, minWidth: 34, minHeight: 34,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: emoji === (mine && mine.emoji) ? 'var(--bg-primary)' : 'none',
                  border: 'none', borderRadius: 999,
                  fontSize: 19, lineHeight: 1, padding: 0, cursor: 'pointer',
                }}>{emoji}</button>
            ))}
          </div>
        </React.Fragment>
      )}
    </div>
  );
};
