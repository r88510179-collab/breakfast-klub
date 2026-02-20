import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { ChatMessage } from "@/lib/ai/openaiCompat";
import { runConsensus, runPrimary, runVerifier, type Strategy } from "@/lib/ai/router";
import { betsToCSV, netUnits, toNumber, type BetRow } from "@/lib/ledger";
