# JM Invest Android

Android 11 이상에서 본인 키움 계좌로 미국주식 지정가 주문을 넣는 앱입니다.
Android Studio에서 이 폴더를 열고 JDK 17과 Android SDK 35로 빌드하세요.
GitHub Actions의 Android build에서 테스트 APK를 받을 수 있습니다.

키움 REST API에 실전계좌와 접속 공인 IP를 등록한 뒤 발급받은 본인의 App Key와 App Secret을 입력하세요. 앱에는 키를 암호화해 보관하고 키움 HTTPS API에 직접 연결합니다.

티커·수량·USD 지정가를 입력한 뒤 매수 또는 매도 확인을 눌러 거래소와 주문 내용을 검토하세요. 기기 인증을 완료하면 주문을 한 번 전송합니다. 결과가 불확실하면 키움에서 접수 내역을 확인한 뒤 앱의 미확인 상태를 해제하세요.
