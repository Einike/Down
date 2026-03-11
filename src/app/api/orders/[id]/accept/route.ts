import { NextResponse } from 'next/server';

// This endpoint has been replaced by:
//   POST /api/orders/[id]/payment-confirm  (seller confirms payment received)
//
// The SELLER_ACCEPTED status was removed in migration 0012.
// Existing clients that call this will get a clear error directing them to the new flow.

export async function POST() {
  return NextResponse.json(
    {
      error:      'This action is no longer available. The order flow has been updated.',
      new_action: 'Use /api/orders/[id]/payment-confirm to confirm payment received.',
    },
    { status: 410 }, // 410 Gone
  );
}
