import { Component, OnInit, Input, Output, EventEmitter, AfterContentInit, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { Mapping } from '../../services/mapping/Mapping';
import { GeoLatLng, GeoPosition } from '../../model/AppModels';
import { IMapProvider, MapOptions } from '../../services/mapping/interfaces/mapping';
import { ExtendedAddressInfo } from '../../model/CoreDataModel';
import { MapBoxMapProvider } from '../../services/mapping/providers/MapBox';
import { Events } from '@ionic/angular';
import { Logging } from '../../services/Logging';
import { HttpClient } from '@angular/common/http';
import { AppManager } from '../../services/AppManager';

@Component({
  selector: 'app-poi-location-editor',
  templateUrl: './poi-location-editor.html',
  styleUrls: ['./poi-location-editor.css'],
})
export class PoiLocationEditorComponent implements OnInit, AfterContentInit, OnChanges {

  @Input() latitude: number;
  @Output() latitudeChange = new EventEmitter();

  @Input() longitude: number;
  @Output() longitudeChange = new EventEmitter();

  suggestedAddress: ExtendedAddressInfo = null;
  @Output() suggestedAddressChange = new EventEmitter();
  @Output() onUseSuggestedAddress = new EventEmitter();

  suggestedAddressAttribution: string = null;
  @Output() suggestedAddressAttributionChange = new EventEmitter();

  originalMarkerPos: GeoLatLng;
  mapService: IMapProvider;
  mapOptions: MapOptions;
  debouncedGecode: any;
  isMapInitialised: boolean = false;

  constructor(public mapping: Mapping,
    private events: Events,
    private logging: Logging,
    private http: HttpClient,
    private appManager: AppManager
  ) { }

  ngOnInit() {

    this.mapService = new MapBoxMapProvider(this.events, this.logging, this.http);
    this.mapService.initAPI();

    this.mapOptions = new MapOptions();

    // listen for map centre moves and use the new position
    this.mapOptions.onMapMoveCompleted = () => {
      this.mapService.getMapCenter().subscribe((pos) => {
        if (pos) {
          this.latitude = pos.coords.latitude;
          this.longitude = pos.coords.longitude;

          this.latitudeChange.emit(this.latitude);
          this.longitudeChange.emit(this.longitude);

          this.getAddressForCurrentLatLng();

        }
      });
    };
  }

  ngAfterContentInit() {
    this.focusMap();
  }

  focusMap() {
    if (this.isMapInitialised == false && this.mapService) {
      if (this.latitude != 0 && this.longitude != 0) {
        this.isMapInitialised = true;
        this.mapService.initMap("editor-map", this.mapOptions, null);

        this.mapService.setMapCenter(new GeoPosition(this.latitude, this.longitude));

        this.originalMarkerPos = new GeoLatLng(this.latitude, this.longitude);
      }
    }
  }

  ngOnChanges(changes: SimpleChanges) {

    this.focusMap();

  }

  async getAddressForCurrentLatLng() {
    if (this.latitude && this.longitude) {
      // now resolve an address
      this.appManager.api.fetchReverseGeocodeResult(this.latitude, this.longitude).then(results => {
        if (results.AddressInfo) {
          this.suggestedAddress = results.AddressInfo;
        }
      });
    }
  }

  useAddressSelection() {
    this.onUseSuggestedAddress.emit({ suggestedAddress: this.suggestedAddress, attribution: this.suggestedAddressAttribution });

    this.suggestedAddress = null;
    this.suggestedAddressAttribution = null;

  }
}