/**
 * Whether a family owes money, and whether they have a card on file. (v1.106.16)
 *
 * Moved out of routes/sessions.js. This is the booking wall's input and belongs with the
 * other money helpers, not inside the router that happens to ask first.
 */
async function checkPaymentStanding(db, familyUserId) {
  // Only block families whose auto-pay has actually FAILED (card declined, auth required, etc.)
  // Sessions still in the grace period (payment_status IS NULL) or processing should NOT block.
  const unpaid = await db.prepare(`
    SELECT cs.id, cs.scheduled_date, cs.caregiver_id,
      u.first_name || ' ' || u.last_name AS caregiver_name
    FROM care_sessions cs
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    LEFT JOIN users u ON cp.user_id = u.id
    WHERE cs.family_user_id = ?
      AND cs.status = 'completed'
      AND cs.payment_status = 'failed'
      AND NOT EXISTS (
        SELECT 1 FROM payments p WHERE p.session_id = cs.id AND p.status IN ('completed', 'processing')
      )
      AND cs.estimated_cost > 0
    ORDER BY cs.scheduled_date DESC
  `).all(familyUserId);

  // Check if family has a saved payment method (Stripe customer with card on file)
  const user = await db.prepare("SELECT stripe_customer_id FROM users WHERE id = ?").get(familyUserId);
  const hasCustomer = !!user?.stripe_customer_id;

  // We'll verify the card exists with Stripe at booking time (in the route handler)
  return { unpaidSessions: unpaid || [], hasStripeCustomer: hasCustomer, stripeCustomerId: user?.stripe_customer_id || null };
}

module.exports = { checkPaymentStanding };
