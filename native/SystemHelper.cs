// Системный помощник PCStation: громкость, звуковые выходы и яркость экрана.
// Работает как постоянный процесс: читает команды из stdin, отвечает JSON-строкой в stdout.
// Команды: state | volume <0..1> | mute <0|1> | device <id> | brightness <0..100>
// Сборка (встроенный компилятор .NET Framework): npm run build:helper
using System;
using System.Collections.Generic;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;

namespace PCStation
{
    enum EDataFlow { Render = 0, Capture = 1, All = 2 }
    enum ERole { Console = 0, Multimedia = 1, Communications = 2 }

    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey
    {
        public Guid fmtid;
        public int pid;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct PropVariant
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr pointer;
        [FieldOffset(8)] public long padding;
        [FieldOffset(16)] public long padding2;
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out int count);
        [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    // Недокументированный, но стабильный с Windows 7 интерфейс смены устройства по умолчанию
    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
    class PolicyConfigCom { }

    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr format);
        [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, bool def, IntPtr format);
        [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
        [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
        [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, bool def, IntPtr defPeriod, IntPtr minPeriod);
        [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr period);
        [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr key, IntPtr value);
        [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr key, IntPtr value);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, ERole role);
        [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, bool visible);
    }

    static class Audio
    {
        static readonly Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        static readonly PropertyKey PKEY_FriendlyName = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
        const int DEVICE_STATE_ACTIVE = 1;
        const int CLSCTX_ALL = 23;

        static IMMDeviceEnumerator Enumerator()
        {
            return (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        }

        static IAudioEndpointVolume DefaultVolume()
        {
            IMMDevice device;
            if (Enumerator().GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out device) != 0 || device == null) return null;
            Guid iid = IID_IAudioEndpointVolume;
            object iface;
            if (device.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out iface) != 0) return null;
            return iface as IAudioEndpointVolume;
        }

        public static string DefaultId()
        {
            IMMDevice device;
            if (Enumerator().GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out device) != 0 || device == null) return null;
            string id;
            device.GetId(out id);
            return id;
        }

        static string Name(IMMDevice device)
        {
            IPropertyStore store;
            if (device.OpenPropertyStore(0, out store) != 0 || store == null) return null;
            PropertyKey key = PKEY_FriendlyName;
            PropVariant value;
            if (store.GetValue(ref key, out value) != 0) return null;
            return value.vt == 31 ? Marshal.PtrToStringUni(value.pointer) : null;
        }

        public static List<KeyValuePair<string, string>> Devices()
        {
            var list = new List<KeyValuePair<string, string>>();
            IMMDeviceCollection collection;
            if (Enumerator().EnumAudioEndpoints(EDataFlow.Render, DEVICE_STATE_ACTIVE, out collection) != 0) return list;
            int count;
            collection.GetCount(out count);
            for (int i = 0; i < count; i++)
            {
                IMMDevice device;
                if (collection.Item(i, out device) != 0 || device == null) continue;
                string id;
                device.GetId(out id);
                list.Add(new KeyValuePair<string, string>(id, Name(device) ?? id));
            }
            return list;
        }

        public static float Volume()
        {
            var v = DefaultVolume();
            float level = -1;
            if (v != null) v.GetMasterVolumeLevelScalar(out level);
            return level;
        }

        public static bool Muted()
        {
            var v = DefaultVolume();
            bool muted = false;
            if (v != null) v.GetMute(out muted);
            return muted;
        }

        public static void SetVolume(float level)
        {
            var v = DefaultVolume();
            Guid ctx = Guid.Empty;
            if (v == null) return;
            v.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, level)), ref ctx);
            if (level > 0) v.SetMute(false, ref ctx);
        }

        public static void SetMute(bool mute)
        {
            var v = DefaultVolume();
            Guid ctx = Guid.Empty;
            if (v != null) v.SetMute(mute, ref ctx);
        }

        public static void SetDefault(string id)
        {
            var policy = (IPolicyConfig)new PolicyConfigCom();
            policy.SetDefaultEndpoint(id, ERole.Console);
            policy.SetDefaultEndpoint(id, ERole.Multimedia);
            policy.SetDefaultEndpoint(id, ERole.Communications);
        }
    }

    static class Brightness
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct PhysicalMonitor
        {
            public IntPtr handle;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string description;
        }

        delegate bool MonitorEnumProc(IntPtr monitor, IntPtr hdc, IntPtr rect, IntPtr data);

        [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc, IntPtr data);
        [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr monitor, out uint count);
        [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr monitor, uint count, [Out] PhysicalMonitor[] monitors);
        [DllImport("dxva2.dll")] static extern bool GetMonitorBrightness(IntPtr handle, out uint min, out uint current, out uint max);
        [DllImport("dxva2.dll")] static extern bool SetMonitorBrightness(IntPtr handle, uint value);
        [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitors(uint count, PhysicalMonitor[] monitors);

        static List<PhysicalMonitor[]> Monitors()
        {
            var result = new List<PhysicalMonitor[]>();
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr m, IntPtr hdc, IntPtr rect, IntPtr data)
            {
                uint count;
                if (GetNumberOfPhysicalMonitorsFromHMONITOR(m, out count) && count > 0)
                {
                    var arr = new PhysicalMonitor[count];
                    if (GetPhysicalMonitorsFromHMONITOR(m, count, arr)) result.Add(arr);
                }
                return true;
            }, IntPtr.Zero);
            return result;
        }

        // Ноутбуки: встроенный экран через WMI
        static int WmiGet()
        {
            try
            {
                using (var s = new ManagementObjectSearcher("root\\WMI", "SELECT CurrentBrightness FROM WmiMonitorBrightness"))
                    foreach (ManagementObject o in s.Get()) return Convert.ToInt32(o["CurrentBrightness"]);
            }
            catch { }
            return -1;
        }

        static bool WmiSet(int value)
        {
            try
            {
                using (var s = new ManagementObjectSearcher("root\\WMI", "SELECT * FROM WmiMonitorBrightnessMethods"))
                    foreach (ManagementObject o in s.Get())
                    {
                        o.InvokeMethod("WmiSetBrightness", new object[] { (uint)1, (byte)value });
                        return true;
                    }
            }
            catch { }
            return false;
        }

        public static int Get()
        {
            int wmi = WmiGet();
            if (wmi >= 0) return wmi;
            // Внешние мониторы: DDC/CI (поддерживают многие мониторы, телевизоры — редко)
            foreach (var arr in Monitors())
            {
                try
                {
                    foreach (var m in arr)
                    {
                        uint min, cur, max;
                        if (GetMonitorBrightness(m.handle, out min, out cur, out max) && max > min)
                            return (int)Math.Round((cur - min) * 100.0 / (max - min));
                    }
                }
                finally { DestroyPhysicalMonitors((uint)arr.Length, arr); }
            }
            return -1;
        }

        public static void Set(int value)
        {
            value = Math.Max(0, Math.Min(100, value));
            if (WmiSet(value)) return;
            foreach (var arr in Monitors())
            {
                try
                {
                    foreach (var m in arr)
                    {
                        uint min, cur, max;
                        if (GetMonitorBrightness(m.handle, out min, out cur, out max) && max > min)
                            SetMonitorBrightness(m.handle, (uint)(min + (max - min) * value / 100));
                    }
                }
                finally { DestroyPhysicalMonitors((uint)arr.Length, arr); }
            }
        }
    }

    static class Program
    {
        static string Esc(string s)
        {
            var sb = new StringBuilder();
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c < 32) sb.AppendFormat("\\u{0:x4}", (int)c);
                else sb.Append(c);
            }
            return sb.ToString();
        }

        static string State(bool withBrightness)
        {
            var sb = new StringBuilder();
            float vol = Audio.Volume();
            string def = Audio.DefaultId();
            sb.Append("{\"volume\":").Append(vol < 0 ? "null" : vol.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture));
            sb.Append(",\"muted\":").Append(Audio.Muted() ? "true" : "false");
            sb.Append(",\"devices\":[");
            bool first = true;
            foreach (var d in Audio.Devices())
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"id\":\"").Append(Esc(d.Key)).Append("\",\"name\":\"").Append(Esc(d.Value)).Append("\",\"default\":").Append(d.Key == def ? "true" : "false").Append('}');
            }
            sb.Append(']');
            if (withBrightness)
            {
                int b = Brightness.Get();
                sb.Append(",\"brightness\":").Append(b < 0 ? "null" : b.ToString());
            }
            sb.Append('}');
            return sb.ToString();
        }

        [STAThread]
        static void Main()
        {
            Console.OutputEncoding = Encoding.UTF8;
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                try
                {
                    var parts = line.Trim().Split(new[] { ' ' }, 2);
                    string cmd = parts[0];
                    string arg = parts.Length > 1 ? parts[1] : "";
                    var inv = System.Globalization.CultureInfo.InvariantCulture;
                    bool brightness = false;
                    if (cmd == "volume") Audio.SetVolume(float.Parse(arg, inv));
                    else if (cmd == "mute") Audio.SetMute(arg == "1");
                    else if (cmd == "device") Audio.SetDefault(arg);
                    else if (cmd == "brightness") { Brightness.Set(int.Parse(arg, inv)); brightness = true; }
                    else if (cmd == "state") brightness = true;
                    else if (cmd == "audio") brightness = false;
                    Console.WriteLine(State(brightness));
                }
                catch (Exception e)
                {
                    Console.WriteLine("{\"error\":\"" + Esc(e.Message) + "\"}");
                }
                Console.Out.Flush();
            }
        }
    }
}
