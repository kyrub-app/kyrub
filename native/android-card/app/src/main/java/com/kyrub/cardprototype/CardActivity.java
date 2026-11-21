package com.kyrub.cardprototype;
import android.app.Activity;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.nfc.NfcAdapter;
import android.nfc.cardemulation.CardEmulation;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.widget.*;

public class CardActivity extends Activity {
    private EditText url;
    private TextView state;
    private CardEmulation emulation;
    private final Handler timer = new Handler(Looper.getMainLooper());
    private final Runnable elapsed = () -> stop("Tempo encerrado. Ative novamente.");
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad=(int)(24*getResources().getDisplayMetrics().density);
        layout.setPadding(pad,pad,pad,pad);
        TextView title=new TextView(this);
        title.setText("Kairub · Cartão NFC experimental"); title.setTextSize(23); layout.addView(title);
        TextView help=new TextView(this);
        help.setText("Cole o endereço público confirmado no Kyrub. Mantenha esta tela aberta e desbloqueada. O envio por NFC depende da compatibilidade do leitor. Não há acesso à conta nem dados privados.");
        layout.addView(help);
        url=new EditText(this); url.setSingleLine(true); url.setHint("https://kyrub.com/@minha-loja");
        url.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        layout.addView(url);
        Button start=new Button(this); start.setText("Ativar cartão por 2 minutos"); layout.addView(start);
        Button stop=new Button(this); stop.setText("Desativar"); layout.addView(stop);
        state=new TextView(this); state.setText("Cartão desativado."); layout.addView(state);
        ScrollView scroll=new ScrollView(this); scroll.setFillViewport(true); scroll.addView(layout); setContentView(scroll);
        start.setOnClickListener(v -> activate());
        stop.setOnClickListener(v -> stop("Cartão desativado."));
    }
    private void activate() {
        stop("Cartão desativado.");
        String candidate=Type4PublicCard.canonicalUrl(url.getText().toString().trim());
        if(candidate==null){state.setText("Informe somente https://kyrub.com/@slug (endereço público canônico).");return;}
        NfcAdapter adapter=NfcAdapter.getDefaultAdapter(this);
        if(adapter==null || !getPackageManager().hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION)){
            state.setText("Este aparelho não oferece NFC HCE.");return;
        }
        if(!adapter.isEnabled()){state.setText("Ative o NFC nas configurações do aparelho.");return;}
        try {
            emulation=CardEmulation.getInstance(adapter);
            if(!emulation.setPreferredService(this,new ComponentName(this,PublicCardService.class))){
                stop("Não foi possível selecionar o serviço NFC para esta tela."); return;
            }
            PublicCardService.arm(candidate);
            url.setEnabled(false);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            timer.postDelayed(elapsed,120_000);
            state.setText("Cartão preparado para transmissão. Aproxime outro celular compatível; a leitura ainda não foi confirmada.");
        } catch(RuntimeException e){ stop("Não foi possível ativar o modo experimental de NFC."); }
    }
    private void stop(String message) {
        PublicCardService.disarm();
        timer.removeCallbacks(elapsed);
        if(emulation!=null){try{emulation.unsetPreferredService(this);}catch(RuntimeException ignored){} emulation=null;}
        if(url!=null) url.setEnabled(true);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if(state!=null) state.setText(message);
    }
    @Override protected void onPause(){ stop("Cartão desativado ao sair da tela."); super.onPause(); }
}
