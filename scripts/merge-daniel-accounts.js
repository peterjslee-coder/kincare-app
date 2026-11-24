#!/usr/bin/env node

/**
 * Migration: Merge duplicate Daniel Lee accounts
 *
 * Situation:
 * - Original account: danbecklee@me.com (has care teams, Kindred access, tester status)
 * - Duplicate account: v7vx2xsc8z@privaterelay.appleid.com (created via Apple "Hide My Email", empty)
 *
 * This script:
 * 1. Finds both user records by email
 * 2. Updates the oauth_accounts entry (provider='apple') from duplicate user_id to original user_id
 * 3. Soft-deletes the duplicate account (set is_active=0)
 * 4. Logs what was done
 *
 * Run with: node scripts/merge-daniel-accounts.js
 */

require("dotenv").config();
const { getDb } = require("../src/models/database");

const ORIGINAL_EMAIL = "danbecklee@me.com";
const DUPLICATE_EMAIL = "v7vx2xsc8z@privaterelay.appleid.com";

async function main() {
  try {
    console.log("🔍 Starting Daniel Lee account merge...\n");

    const db = await getDb();

    // Step 1: Find the original account
    console.log(`Searching for original account: ${ORIGINAL_EMAIL}`);
    const originalUser = await db.prepare(
      "SELECT id, email, is_active FROM users WHERE email = ?"
    ).get(ORIGINAL_EMAIL);

    if (!originalUser) {
      console.error(`❌ ERROR: Original account not found: ${ORIGINAL_EMAIL}`);
      process.exit(1);
    }

    console.log(
      `✅ Found original account:\n   ID: ${originalUser.id}\n   Email: ${originalUser.email}\n   Active: ${originalUser.is_active}\n`
    );

    // Step 2: Find the duplicate account
    console.log(`Searching for duplicate account: ${DUPLICATE_EMAIL}`);
    const duplicateUser = await db.prepare(
      "SELECT id, email, is_active FROM users WHERE email = ?"
    ).get(DUPLICATE_EMAIL);

    if (!duplicateUser) {
      console.error(`❌ ERROR: Duplicate account not found: ${DUPLICATE_EMAIL}`);
      process.exit(1);
    }

    console.log(
      `✅ Found duplicate account:\n   ID: ${duplicateUser.id}\n   Email: ${duplicateUser.email}\n   Active: ${duplicateUser.is_active}\n`
    );

    // Step 3: Check for Apple oauth_account on the duplicate
    console.log("Searching for Apple OAuth account linked to duplicate...");
    const duplicateOAuth = await db.prepare(
      "SELECT id, provider, provider_user_id FROM oauth_accounts WHERE user_id = ? AND provider = 'apple'"
    ).get(duplicateUser.id);

    if (!duplicateOAuth) {
      console.warn(`⚠️  No Apple OAuth account found on duplicate. Nothing to migrate.`);
      console.log("The duplicate account is already clean (no oauth_accounts linked).");
    } else {
      console.log(
        `✅ Found Apple OAuth account:\n   OAuth ID: ${duplicateOAuth.id}\n   Provider User ID: ${duplicateOAuth.provider_user_id}\n`
      );

      // Step 4: Update oauth_accounts to point to original user
      console.log(
        `Updating oauth_accounts entry to link to original user (${originalUser.id})...`
      );
      const updateResult = await db.prepare(
        "UPDATE oauth_accounts SET user_id = ? WHERE id = ?"
      ).run(originalUser.id, duplicateOAuth.id);

      if (updateResult.changes === 1) {
        console.log(
          `✅ Successfully migrated Apple OAuth account to original user.\n`
        );
      } else {
        console.error(
          `❌ ERROR: Failed to update oauth_accounts (rows affected: ${updateResult.changes})`
        );
        process.exit(1);
      }
    }

    // Step 5: Soft-delete the duplicate account
    console.log(
      `Soft-deleting duplicate account (setting is_active = 0)...`
    );
    const deleteResult = await db.prepare(
      "UPDATE users SET is_active = 0 WHERE id = ?"
    ).run(duplicateUser.id);

    if (deleteResult.changes === 1) {
      console.log(`✅ Successfully deactivated duplicate account.\n`);
    } else {
      console.error(
        `❌ ERROR: Failed to deactivate duplicate account (rows affected: ${deleteResult.changes})`
      );
      process.exit(1);
    }

    // Step 6: Summary
    console.log("╔════════════════════════════════════════╗");
    console.log("║       MERGE COMPLETED SUCCESSFULLY     ║");
    console.log("╚════════════════════════════════════════╝\n");
    console.log(`Original Account (KEPT):`);
    console.log(`  Email: ${originalUser.email}`);
    console.log(`  ID: ${originalUser.id}`);
    console.log(`  Status: Active\n`);

    console.log(`Duplicate Account (DEACTIVATED):`);
    console.log(`  Email: ${duplicateUser.email}`);
    console.log(`  ID: ${duplicateUser.id}`);
    console.log(`  Status: Deactivated (is_active = 0)\n`);

    if (duplicateOAuth) {
      console.log(`Apple OAuth Link:`);
      console.log(`  Migrated from: ${duplicateUser.id}`);
      console.log(`  Migrated to:   ${originalUser.id}`);
      console.log(`  Provider User ID: ${duplicateOAuth.provider_user_id}\n`);
    }

    console.log("Daniel Lee's duplicate account has been successfully cleaned up.");
    console.log("The original account now owns all OAuth credentials and data.\n");

    process.exit(0);
  } catch (err) {
    console.error("❌ MIGRATION FAILED");
    console.error(err);
    process.exit(1);
  }
}

main();
