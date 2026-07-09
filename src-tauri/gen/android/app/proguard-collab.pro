-keep class com.azazel.collab.companion.CollabTokenStore {
    public static java.lang.String storeRefreshToken(android.content.Context, java.lang.String, java.lang.String);
    public static java.lang.String readRefreshToken(android.content.Context, java.lang.String);
    public static java.lang.String deleteRefreshToken(android.content.Context, java.lang.String);
}

-keep class com.azazel.collab.companion.CollabReplicaKeyStore {
    public static java.lang.String storeKey(android.content.Context, java.lang.String, java.lang.String);
    public static java.lang.String readKey(android.content.Context, java.lang.String);
    public static java.lang.String deleteKey(android.content.Context, java.lang.String);
}
