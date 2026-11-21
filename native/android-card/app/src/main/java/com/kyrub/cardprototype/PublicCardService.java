package com.kyrub.cardprototype;
import android.nfc.cardemulation.HostApduService;
import android.os.Bundle;
import android.os.SystemClock;

public class PublicCardService extends HostApduService {
    private static final Type4PublicCard CARD = new Type4PublicCard();
    private static long expiresAt;
    public static synchronized void arm(String url) {
        CARD.enable(url);
        expiresAt = SystemClock.elapsedRealtime() + 120_000;
    }
    public static synchronized void disarm() {
        expiresAt = 0; CARD.disable();
    }
    @Override public byte[] processCommandApdu(byte[] commandApdu, Bundle extras) {
        synchronized(PublicCardService.class) {
            if (SystemClock.elapsedRealtime() >= expiresAt) disarm();
            return CARD.process(commandApdu);
        }
    }
    @Override public void onDeactivated(int reason) {
        synchronized(PublicCardService.class) { CARD.reset(); }
    }
}
