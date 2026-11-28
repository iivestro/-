import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Linking, PermissionsAndroid, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import routing from './navigation.cjs';

const production = Constants.expoConfig?.extra?.production === true;
const source = { uri: routing.home(production) };
const locationPermission = `(function(){
  if (!navigator.geolocation || !window.ReactNativeWebView || window.balsamGeoReady) return;
  window.balsamGeoReady = true;
  const geo = navigator.geolocation;
  const original = geo.getCurrentPosition.bind(geo);
  const queue = [];
  geo.getCurrentPosition = function(ok, fail, options){
    queue.push({ok, fail, options});
    if (queue.length === 1) window.ReactNativeWebView.postMessage('location');
  };
  window.balsamLocationPermission = function(granted){
    for (const request of queue.splice(0)) {
      if (granted) original(request.ok, request.fail, request.options);
      else if (request.fail) request.fail({code:1,message:'تعذر الوصول إلى الموقع'});
    }
  };
})();true;`;

export default function App() {
  const web = useRef(null);
  const canGoBack = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack.current || !web.current) return false;
      web.current.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);
  function allow(url) {
    const result = routing.action(url, production);
    if (result === 'external') Linking.openURL(url).catch(() => Alert.alert('تعذّر فتح الرابط'));
    return result === 'inside';
  }
  async function onMessage({nativeEvent}) {
    if (Platform.OS !== 'android' || nativeEvent.data !== 'location' || routing.action(nativeEvent.url, production) !== 'inside') return;
    const { ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION } = PermissionsAndroid.PERMISSIONS;
    let granted = false;
    try {
      const permissions = await PermissionsAndroid.requestMultiple([ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION]);
      granted = Object.values(permissions).includes(PermissionsAndroid.RESULTS.GRANTED);
    } finally {
      web.current?.injectJavaScript('window.balsamLocationPermission?.(' + granted + ');true;');
    }
  }
  function retry() {
    canGoBack.current = false;
    setFailed(false); setLoading(true); setAttempt(value => value + 1);
  }
  return <SafeAreaProvider><SafeAreaView style={styles.page}>
    <StatusBar barStyle="dark-content" />
    {failed ? <View style={styles.center}>
      <Text style={styles.title}>تعذّر فتح بلسم</Text>
      <Text>تأكد من اتصال الإنترنت وحاول مرة ثانية.</Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.button}><Text style={styles.white}>إعادة المحاولة</Text></Pressable>
    </View> : <WebView ref={web} key={attempt} source={source}
      originWhitelist={['*']} onShouldStartLoadWithRequest={request => request.isTopFrame === false || allow(request.url)}
      onOpenWindow={({nativeEvent}) => {
        if (allow(nativeEvent.targetUrl)) web.current?.injectJavaScript('location.assign(' + JSON.stringify(nativeEvent.targetUrl) + ');true;');
      }}
      allowsBackForwardNavigationGestures domStorageEnabled geolocationEnabled
      mixedContentMode="never" allowFileAccess={false}
      injectedJavaScript={Platform.OS === 'android' ? locationPermission : undefined}
      onMessage={onMessage} onNavigationStateChange={state => { canGoBack.current = state.canGoBack; }}
      onLoadStart={() => setLoading(true)} onLoadEnd={() => setLoading(false)}
      onError={() => setFailed(true)} onContentProcessDidTerminate={retry}
      onHttpError={({nativeEvent}) => { if (nativeEvent.url === source.uri) setFailed(true); }}
    />}
    {loading && !failed && <View pointerEvents="none" style={styles.progress}><ActivityIndicator color="#087f83" /></View>}
  </SafeAreaView></SafeAreaProvider>;
}
const styles = StyleSheet.create({
  page:{flex:1, backgroundColor:'#f5faf9'}, center:{flex:1,alignItems:'center',justifyContent:'center',gap:16,padding:24},
  title:{fontSize:24,fontWeight:'700',color:'#153b49'},button:{backgroundColor:'#087f83',borderRadius:12,padding:14},
  white:{color:'white',fontWeight:'700'},progress:{position:'absolute',bottom:'7%',alignSelf:'center',padding:8,backgroundColor:'white',borderRadius:20}
});
