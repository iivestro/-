const production = process.env.BALSAM_ENV === 'production';
const id = production ? 'com.balsamiraq.mobile' : 'com.balsamiraq.mobile.training';
module.exports = {
  name: production ? 'بلسم' : 'بلسم التجريبي',
  slug: 'balsam-mobile', version: '1.0.0', icon: '../app-icons/balsam-512.png',
  ios: { bundleIdentifier: id, supportsTablet: true, infoPlist: {
    NSLocationWhenInUseUsageDescription: 'يستخدم بلسم موقعك عند طلب خدمة منزلية أو البحث عن طبيب قريب.',
    NSCameraUsageDescription: 'التقاط صورة لإرفاقها بطلبك.',
    NSPhotoLibraryUsageDescription: 'اختيار صورة أو تقرير لإرفاقه بطلبك.'
  }},
  android: { package: id, permissions: ['ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION'] },
  extra: { production }
};
