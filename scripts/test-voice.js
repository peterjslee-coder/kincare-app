#!/usr/bin/env node
/**
 * test-voice.js — Generate test audio clips for Betty using Pete's cloned voice.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=your_key node scripts/test-voice.js
 *
 * Generates MP3 files in scripts/voice-test-output/
 * Play them for Betty to validate Phase 0.
 */

const fs = require("fs");
const path = require("path");
const { generateSpeech, getVoice, getUsage } = require("../src/utils/voiceService");

// Pete's cloned voice
const PETE_VOICE_ID = "c2liOZ7MsLVLDpKuwIY5";

// Test phrases — these are what Betty would actually hear
const TEST_PHRASES = [
  {
    name: "medication-reminder",
    text: "Hey Mom, it's about ten o'clock. Don't forget your Tylenol — take it with some water, okay?",
    description: "Morning medication reminder",
  },
  {
    name: "morning-greeting",
    text: "Good morning, Mom! Pete wanted me to check in on you. How did you sleep last night?",
    description: "Morning check-in (companion identity — says 'Pete wanted me to')",
  },
  {
    name: "caregiver-arrival",
    text: "Hey Mom, just a heads up — Cary's coming over at two today. She mentioned she'd bring that puzzle you liked.",
    description: "Caregiver visit alert",
  },
  {
    name: "encouragement",
    text: "Mom, Pete loves you. He asked me to tell you he's thinking about you today.",
    description: "Affection (companion identity — says 'Pete loves you', not 'I love you')",
  },
  {
    name: "slow-and-clear",
    text: "Hey Mom, it's about ten o'clock. Don't forget your Tylenol — take it with some water, okay?",
    description: "Same med reminder but slower and more stable (testing elderly-friendly settings)",
    voiceSettings: { speed: 0.85, stability: 0.8 },
  },
];

const OUTPUT_DIR = path.join(__dirname, "voice-test-output");

async function main() {
  // Preflight checks
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("Error: Set ELEVENLABS_API_KEY environment variable.");
    console.error("  ELEVENLABS_API_KEY=your_key node scripts/test-voice.js");
    process.exit(1);
  }

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Check voice exists
  console.log("Checking voice clone...");
  try {
    const voice = await getVoice(PETE_VOICE_ID);
    console.log(`  Voice: ${voice.name}`);
    console.log(`  Category: ${voice.category}`);
    console.log(`  Labels: ${JSON.stringify(voice.labels || {})}`);
  } catch (err) {
    console.error(`  Failed to fetch voice: ${err.message}`);
    process.exit(1);
  }

  // Check credits
  console.log("\nChecking credit usage...");
  try {
    const usage = await getUsage();
    const remaining = usage.character_limit - usage.character_count;
    console.log(`  Credits used: ${usage.character_count.toLocaleString()} / ${usage.character_limit.toLocaleString()}`);
    console.log(`  Remaining: ${remaining.toLocaleString()}`);

    // Estimate cost of test phrases
    const totalChars = TEST_PHRASES.reduce((sum, p) => sum + p.text.length, 0);
    console.log(`  This test will use ~${totalChars} credits (${TEST_PHRASES.length} phrases)`);

    if (remaining < totalChars) {
      console.error("  Not enough credits! Reduce test phrases or upgrade plan.");
      process.exit(1);
    }
  } catch (err) {
    console.warn(`  Could not check usage: ${err.message} (continuing anyway)`);
  }

  // Generate each test phrase
  console.log(`\nGenerating ${TEST_PHRASES.length} test clips...\n`);

  for (const phrase of TEST_PHRASES) {
    const filename = `${phrase.name}.mp3`;
    const filepath = path.join(OUTPUT_DIR, filename);

    console.log(`  [${phrase.name}] ${phrase.description}`);
    console.log(`    "${phrase.text}"`);

    try {
      const audioBuffer = await generateSpeech(
        phrase.text,
        PETE_VOICE_ID,
        phrase.voiceSettings || {}
      );

      fs.writeFileSync(filepath, audioBuffer);
      const sizeKb = Math.round(audioBuffer.length / 1024);
      console.log(`    ✓ Saved: ${filename} (${sizeKb} KB)\n`);
    } catch (err) {
      console.error(`    ✗ Failed: ${err.message}\n`);
    }
  }

  console.log(`Done! Audio files saved to: ${OUTPUT_DIR}`);
  console.log("\nPlay these for Betty. If her face lights up — we build the full thing.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
