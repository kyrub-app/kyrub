package com.kyrub.cardprototype;
import java.util.Arrays;
import java.nio.charset.StandardCharsets;
public final class Type4PublicCardTest {
    static void eq(byte[] got,String expected){if(!Arrays.equals(got,Type4PublicCard.hex(expected)))throw new AssertionError(expected);}
    public static void main(String[] args){
        Type4PublicCard card=new Type4PublicCard();
        String url="https://kyrub.com/@kyrub-oficial";
        if(Type4PublicCard.canonicalUrl(url)==null || Type4PublicCard.canonicalUrl(url+"?token=x")!=null ||
          Type4PublicCard.canonicalUrl("https://other.com/@loja")!=null)throw new AssertionError("URL");
        eq(card.process(Type4PublicCard.hex("00A4040007D276000085010100")),"6985");
        card.enable(url);
        eq(card.process(Type4PublicCard.hex("00B000000F")),"6985");
        eq(card.process(Type4PublicCard.hex("00A4040007D276000085010100")),"9000");
        eq(card.process(Type4PublicCard.hex("00A4000C02E103")),"9000");
        eq(card.process(Type4PublicCard.hex("00B000000F")),"000F2000FF00340406E104020000FF9000");
        eq(card.process(Type4PublicCard.hex("00A4000C02E104")),"9000");
        byte[] size=card.process(Type4PublicCard.hex("00B0000002"));
        int length=((size[0]&255)<<8)|(size[1]&255);
        byte[] record=card.process(new byte[]{0,(byte)0xB0,0,2,(byte)length});
        if(record[0]!=(byte)0xD1 || record[3]!=0x55 || record[4]!=4 ||
           !url.equals("https://"+new String(record,5,length-5,StandardCharsets.US_ASCII)))throw new AssertionError("NDEF URL");
        eq(card.process(Type4PublicCard.hex("00D600000100")),"6D00");
        card.reset();
        eq(card.process(Type4PublicCard.hex("00B0000002")),"6985");
        card.disable();
        eq(card.process(Type4PublicCard.hex("00A4040007D276000085010100")),"6985");
        System.out.println("Type4PublicCardTest passed");
    }
}
