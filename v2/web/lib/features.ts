export type FeatureField=[string,string,string?];
export type FeatureDefinition={action:string;title:string;roles:string[];fields?:FeatureField[]};
export const features:FeatureDefinition[]=[
  {action:"visit_reminders",title:"تذكير بمواعيدي خلال 24 ساعة",roles:["patient"]},
  {
    "action": "announcements",
    "title": "إشعارات وإعلانات المنصة",
    "roles": [
      "patient",
      "doctor",
      "medical_center",
      "representative",
      "home_provider",
      "admin",
      "staff"
    ]
  },
  {
    "action": "maintenance_status",
    "title": "حالة الصيانة",
    "roles": [
      "patient",
      "doctor",
      "medical_center",
      "representative",
      "home_provider",
      "admin",
      "staff"
    ]
  },
  {
    "action": "support_list",
    "title": "تذاكر الدعم الفني",
    "roles": [
      "patient",
      "doctor",
      "medical_center",
      "representative",
      "home_provider",
      "admin",
      "staff"
    ]
  },
  {
    "action": "support_create",
    "title": "إرسال طلب دعم",
    "roles": [
      "patient",
      "doctor",
      "medical_center",
      "representative",
      "home_provider"
    ],
    "fields": [
      [
        "subject",
        "عنوان المشكلة"
      ],
      [
        "body",
        "التفاصيل (لا تضع معلومات طبية)"
      ]
    ]
  },
  {
    "action": "queue_my",
    "title": "دوري الإلكتروني",
    "roles": [
      "patient"
    ]
  },
  {
    "action": "health_list",
    "title": "ملفي الصحي الشخصي",
    "roles": [
      "patient"
    ]
  },
  {
    "action": "health_add",
    "title": "إضافة سجل صحي خاص",
    "roles": [
      "patient"
    ],
    "fields": [
      [
        "category",
        "نوع السجل",
        "analysis|prescription|report|other"
      ],
      [
        "title",
        "عنوان السجل"
      ],
      [
        "note",
        "ملاحظة (اختيارية)",
        "optional"
      ],
      [
        "record_date",
        "تاريخ السجل",
        "date"
      ]
    ]
  },
  {
    "action": "nearby",
    "title": "الأطباء والمراكز بالقرب مني",
    "roles": [
      "patient"
    ],
    "fields": [
      [
        "latitude",
        "خط العرض",
        "number"
      ],
      [
        "longitude",
        "خط الطول",
        "number"
      ]
    ]
  },
  {
    "action": "regions",
    "title": "المناطق والمحافظات",
    "roles": [
      "patient",
      "admin",
      "staff"
    ]
  },
  {
    "action": "queue_provider",
    "title": "الدور الإلكتروني اليوم",
    "roles": [
      "doctor",
      "medical_center"
    ]
  },
  {
    "action": "queue_bookings",
    "title": "تسجيل حضور من حجوزات اليوم",
    "roles": [
      "doctor",
      "medical_center"
    ]
  },
  {
    "action": "admin_summary",
    "title": "إيرادات ومؤشرات الإدارة",
    "roles": [
      "admin"
    ]
  },
  {
    "action": "announcement_admin_list",
    "title": "إدارة الإشعارات والإعلانات",
    "roles": [
      "admin",
      "staff"
    ]
  },
  {
    "action": "announcement_create",
    "title": "إنشاء إعلان أو تنبيه (مسودة)",
    "roles": [
      "admin",
      "staff"
    ],
    "fields": [
      [
        "kind",
        "نوع المحتوى",
        "notice|advertisement"
      ],
      [
        "title",
        "العنوان"
      ],
      [
        "body",
        "المحتوى"
      ],
      [
        "ends_at",
        "تاريخ الانتهاء",
        "datetime-local"
      ]
    ]
  },
  {
    "action": "maintenance_set",
    "title": "إيقاف أو استئناف الحجوزات للصيانة",
    "roles": [
      "admin"
    ],
    "fields": [
      [
        "enabled",
        "الحالة",
        "true|false"
      ],
      [
        "message",
        "رسالة الصيانة",
        "optional"
      ]
    ]
  },
  {
    "action": "region_set",
    "title": "إضافة / تحديث منطقة",
    "roles": [
      "admin",
      "staff"
    ],
    "fields": [
      [
        "governorate",
        "المحافظة"
      ],
      [
        "district",
        "المنطقة"
      ],
      [
        "active",
        "الحالة",
        "true|false"
      ]
    ]
  },
  {
    "action": "staff_list",
    "title": "صلاحيات الموظفين المقترحة",
    "roles": [
      "admin"
    ]
  },
  {
    "action": "staff_set",
    "title": "تفعيل أو إيقاف صلاحية موظف",
    "roles": [
      "admin"
    ],
    "fields": [
      [
        "user_id",
        "معرف حساب الموظف"
      ],
      [
        "permission",
        "الصلاحية",
        "support|subscriptions|reports|announcements|regions|monitoring"
      ],
      [
        "active",
        "الحالة",
        "true|false"
      ]
    ]
  },
  {
    "action": "geo_set",
    "title": "تحديد موقع مقدم خدمة",
    "roles": [
      "admin"
    ],
    "fields": [
      [
        "kind",
        "نوع الخدمة",
        "doctor|center|home"
      ],
      [
        "provider_id",
        "معرف مقدم الخدمة"
      ],
      [
        "latitude",
        "خط العرض",
        "number"
      ],
      [
        "longitude",
        "خط الطول",
        "number"
      ]
    ]
  },
  {
    "action": "payment_record",
    "title": "تسجيل دفعة مستلمة",
    "roles": [
      "admin"
    ],
    "fields": [
      [
        "service",
        "الخدمة",
        "doctor|center|representative|home|advertisement"
      ],
      [
        "amount_iqd",
        "المبلغ بالدينار",
        "number"
      ],
      [
        "reference",
        "رقم وصل الدفع"
      ],
      [
        "paid_at",
        "تاريخ الدفع",
        "datetime-local"
      ]
    ]
  },
  {
    "action": "staff_permissions",
    "title": "صلاحياتي",
    "roles": [
      "staff"
    ]
  },
  {
    "action": "reports_read",
    "title": "التقارير المالية",
    "roles": [
      "admin",
      "staff"
    ]
  },
  {
    "action": "monitoring_read",
    "title": "مراقبة الأخطاء",
    "roles": [
      "admin",
      "staff"
    ]
  },
  {
    "action": "subscription_read",
    "title": "الاشتراكات القريبة من الانتهاء",
    "roles": [
      "admin",
      "staff"
    ]
  }
];
export const labels:Record<string,string>={"patient_name":"اسم المراجع","appointment_at":"موعد الحضور","provider_name":"اسم مقدم الخدمة","subscription_expires_at":"انتهاء الاشتراك","event_type":"نوع الخطأ","component":"القسم","event_count":"عدد الأخطاء","id":"المعرف","subject":"العنوان","body":"التفاصيل","status":"الحالة","reply":"رد الإدارة","created_at":"تاريخ الإنشاء","updated_at":"آخر تحديث","category":"النوع","title":"العنوان","note":"ملاحظة","record_date":"تاريخ السجل","kind":"النوع","booking_id":"معرف الحجز","provider_id":"معرف مقدم الخدمة","service_date":"اليوم","queue_number":"رقم الدور","state":"الحالة","ahead":"عدد المراجعين قبلك","distance_km":"المسافة الجوية (كم)","latitude":"خط العرض","longitude":"خط الطول","recorded_revenue_iqd":"الإيرادات المسجلة بالدينار هذا الشهر","payment_count":"عدد الدفعات","support_open":"التذاكر المفتوحة","subscriptions_expiring":"الاشتراكات المنتهية خلال 7 أيام","errors_24h":"الأخطاء المسجلة آخر 24 ساعة","maintenance":"وضع الصيانة","message":"رسالة الصيانة","starts_at":"البداية","ends_at":"النهاية","published":"منشور","governorate":"المحافظة","district":"المنطقة","active":"فعال","permission":"الصلاحية","user_id":"معرف الموظف","saved":"تم الحفظ","updated":"تم التحديث","deleted":"تم الحذف","enforced":"مطبق فعلياً","registered":"تم التسجيل"};
export const values:Record<string,string>={"analysis":"تحليل","prescription":"وصفة طبية","report":"تقرير","other":"أخرى","notice":"إشعار","advertisement":"إعلان","waiting":"بانتظار الدور","called":"حان الدور","completed":"مكتمل","cancelled":"ملغى","open":"مفتوحة","answered":"تم الرد","closed":"مغلقة","doctor":"طبيب","center":"مركز طبي","representative":"مندوب","home":"رعاية منزلية","support":"الدعم الفني","subscriptions":"الاشتراكات","reports":"التقارير","announcements":"الإعلانات والإشعارات","regions":"المناطق","monitoring":"المراقبة","true":"نعم","false":"لا"};
export function display(v:unknown){if(v===null||v===undefined)return '—';return values[String(v)]??String(v);}
