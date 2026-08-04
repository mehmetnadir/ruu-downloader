package main

import (
	"reflect"
	"testing"
)

func TestMergeRange(t *testing.T) {
	var rs []Range
	rs = MergeRange(rs, Range{0, 10})
	rs = MergeRange(rs, Range{20, 30})
	rs = MergeRange(rs, Range{10, 20}) // köprü: üçü tek aralığa inmeli
	if !reflect.DeepEqual(rs, []Range{{0, 30}}) {
		t.Fatalf("bitişik aralıklar birleşmedi: %v", rs)
	}
}

func TestMergeRangeOverlap(t *testing.T) {
	rs := MergeRange([]Range{{0, 100}}, Range{50, 150})
	if !reflect.DeepEqual(rs, []Range{{0, 150}}) {
		t.Fatalf("örtüşme yanlış: %v", rs)
	}
	// Sıfır ve negatif uzunluk yok sayılmalı
	if got := MergeRange(rs, Range{5, 5}); !reflect.DeepEqual(got, rs) {
		t.Fatalf("boş aralık kümeyi değiştirdi: %v", got)
	}
}

func TestMissingRanges(t *testing.T) {
	got := MissingRanges([]Range{{0, 10}, {20, 30}}, 50)
	want := []Range{{10, 20}, {30, 50}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("boşluklar yanlış: %v", got)
	}
	if got := MissingRanges([]Range{{0, 50}}, 50); got != nil {
		t.Fatalf("tam dosyada boşluk çıktı: %v", got)
	}
	if got := MissingRanges(nil, 30); !reflect.DeepEqual(got, []Range{{0, 30}}) {
		t.Fatalf("boş kümede tüm dosya beklenir: %v", got)
	}
}

func TestSplitWork(t *testing.T) {
	// 100 baytı 4'e böl, en küçük parça 10
	got := SplitWork([]Range{{0, 100}}, 4, 10)
	if len(got) != 4 {
		t.Fatalf("4 parça beklenirdi: %v", got)
	}
	if Downloaded(got) != 100 {
		t.Fatalf("parçalar dosyayı kapsamıyor: %d", Downloaded(got))
	}
	// Ardışıklık: parçalar arasında boşluk/örtüşme olmamalı
	for i := 1; i < len(got); i++ {
		if got[i].Start != got[i-1].End {
			t.Fatalf("parçalar bitişik değil: %v", got)
		}
	}
}

func TestSplitWorkTinyFileNotOverSplit(t *testing.T) {
	// 15 bayt, 8 bağlantı istense de minChunk=10 yüzünden tek parça kalmalı:
	// bir baytı sekize bölmek bağlantı kurulum maliyetini boşa harcar.
	got := SplitWork([]Range{{0, 15}}, 8, 10)
	if len(got) != 1 {
		t.Fatalf("küçük dosya gereksiz bölündü: %v", got)
	}
}

func TestSplitWorkAcrossGaps(t *testing.T) {
	got := SplitWork([]Range{{0, 50}, {100, 150}}, 2, 10)
	if Downloaded(got) != 100 {
		t.Fatalf("boşluklar tam kapsanmadı: %d", Downloaded(got))
	}
	for _, r := range got {
		if (r.Start >= 50 && r.Start < 100) || (r.End > 50 && r.End <= 100) {
			t.Fatalf("parça inen bölgeye taştı: %v", r)
		}
	}
}

func TestIsComplete(t *testing.T) {
	if !IsComplete([]Range{{0, 100}}, 100) {
		t.Fatal("tam dosya complete sayılmadı")
	}
	if IsComplete([]Range{{0, 50}, {50, 100}}, 100) {
		t.Fatal("birleşmemiş küme complete sayıldı")
	}
	if IsComplete(nil, 100) {
		t.Fatal("boş küme complete sayıldı")
	}
}
