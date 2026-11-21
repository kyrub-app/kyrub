package com.kyrub.cardprototype;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Read-only NFC Forum Type 4 NDEF URI experimental responder. No user secrets or payments. */
public final class Type4PublicCard {
    private static final byte[] AID = hex("D2760000850101");
    private static final byte[] CC = hex("000F2000FF00340406E104020000FF");
    private static final byte[] OK = hex("9000"), NOT_FOUND = hex("6A82"),
        INVALID = hex("6700"), DENIED = hex("6985");
    private boolean selected;
    private int file;
    private byte[] ndef;
    public static String canonicalUrl(String input) {
        if (input == null || !input.matches("https://kyrub\\.com/@[a-z0-9]+(?:-[a-z0-9]+)*") ||
            input.length() > 139) return null;
        return input;
    }
    public void enable(String url) {
        if (canonicalUrl(url) == null) throw new IllegalArgumentException("Only canonical public Kyrub storefront links");
        byte[] suffix = url.substring("https://".length()).getBytes(StandardCharsets.US_ASCII);
        byte[] record = new byte[suffix.length + 5];
        record[0] = (byte)0xD1; record[1] = 1; record[2] = (byte)(suffix.length + 1);
        record[3] = 0x55; record[4] = 4; // URI identifier 0x04 = https://
        System.arraycopy(suffix, 0, record, 5, suffix.length);
        ndef = new byte[record.length + 2];
        ndef[0] = (byte)(record.length >>> 8); ndef[1] = (byte)record.length;
        System.arraycopy(record, 0, ndef, 2, record.length);
        reset();
    }
    public void disable() { ndef = null; reset(); }
    public void reset() { selected = false; file = 0; }
    public byte[] process(byte[] apdu) {
        if (ndef == null) return DENIED.clone();
        if (apdu == null || apdu.length < 4) return INVALID.clone();
        int cla = apdu[0]&255, ins=apdu[1]&255, p1=apdu[2]&255, p2=apdu[3]&255;
        if (cla != 0) return hex("6E00");
        if (ins == 0xA4) {
            if (apdu.length < 5) return INVALID.clone();
            int lc=apdu[4]&255;
            if (apdu.length != 5+lc && apdu.length != 6+lc) return INVALID.clone();
            byte[] value=Arrays.copyOfRange(apdu,5,5+lc);
            if (p1==4) {
                reset();
                if ((p2==0 || p2==12) && Arrays.equals(value,AID)) { selected=true; return OK.clone(); }
                return NOT_FOUND.clone();
            }
            if (!selected) return DENIED.clone();
            file=0;
            if (p1==0 && (p2==0 || p2==12) && lc==2) {
                int id=((value[0]&255)<<8)|(value[1]&255);
                if (id==0xE103 || id==0xE104) { file=id; return OK.clone(); }
            }
            return NOT_FOUND.clone();
        }
        if (ins == 0xB0) {
            if (!selected || file==0) return DENIED.clone();
            if (apdu.length!=5 || (p1&0x80)!=0) return INVALID.clone();
            byte[] source=file==0xE103?CC:ndef;
            int offset=(p1<<8)|p2, length=apdu[4]&255;
            if (length==0) length=256;
            if (offset>=source.length) return hex("6B00");
            int count=Math.min(length,source.length-offset);
            byte[] response=Arrays.copyOfRange(source,offset,offset+count+2);
            response[count]=(byte)0x90; response[count+1]=0;
            return response;
        }
        return hex("6D00"); // UPDATE BINARY and all other instructions refused
    }
    public static byte[] hex(String s) {
        byte[] result=new byte[s.length()/2];
        for(int i=0;i<result.length;i++) result[i]=(byte)Integer.parseInt(s.substring(2*i,2*i+2),16);
        return result;
    }
}
