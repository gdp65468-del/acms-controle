# Configuracao do login Google no APK Android

O login do APK usa o SDK nativo do Google, pois o popup web nao consegue retornar de forma confiavel ao WebView Android.

## Cadastro necessario no Firebase

1. Abra o projeto Firebase ja usado pelo ACMS e adicione um aplicativo Android.
2. Use exatamente este pacote: `com.acmscontrole.mobile`.
3. Informe o SHA-1 desta assinatura debug:

   ```
   89:7B:CB:74:02:A6:90:00:CD:32:90:E3:C5:37:02:26:89:CF:1D:D7
   ```

4. Em **Authentication > Sign-in method**, confirme que o provedor Google esta habilitado.
5. Baixe o arquivo `google-services.json` do aplicativo Android criado e coloque-o em `android/app/google-services.json`.

O arquivo esta no `.gitignore`; nao o envie ao GitHub. Depois de coloca-lo, gere um novo APK com `npm run android:apk`.

## Publicacao futura

Para Play Store, crie uma chave de assinatura de release e cadastre tambem o SHA-1 dela no mesmo aplicativo Android do Firebase. Se usar Play App Signing, cadastre ainda o SHA-1 exibido pela Play Console e baixe novamente o `google-services.json`.
