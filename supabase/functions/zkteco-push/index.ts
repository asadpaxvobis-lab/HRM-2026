// ZKTeco ADMS push (legacy path) — authenticate devices via push_token, ingest ATTLOG punches.
// Deploy: supabase functions deploy zkteco-push --project-ref zxkkmwycimijvbpgqpfh --no-verify-jwt
// Device URL: {SUPABASE_URL}/functions/v1/zkteco-push/iclock/cdata?token={push_token}&SN={serial}

import { handleZktPush } from '../_shared/zkt-push.ts'

Deno.serve((req) => handleZktPush(req))
