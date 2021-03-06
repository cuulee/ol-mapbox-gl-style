/*
ol-mapbox-gl-style - Use Mapbox GL style objects with OpenLayers
Copyright 2016 Boundless Spatial, Inc.
License: https://raw.githubusercontent.com/boundlessgeo/ol-mapbox-gl-style/master/LICENSE.md
*/

var ol = require('openlayers');
var glfun = require('mapbox-gl-function');
var mb2css = require('mapbox-to-css-font');
var colorToArray = require('color-string').get.rgb;
var FontFaceObserver = require('fontfaceobserver');

var functions = {
  interpolated: [
    'line-miter-limit',
    'fill-opacity',
    'line-opacity',
    'line-width',
    'text-offset',
    'text-size',
    'icon-opacity',
    'icon-rotate',
    'icon-size'
  ],
  'piecewise-constant': [
    'fill-color',
    'fill-outline-color',
    'line-color'
  ]
};

var defaults = {
  'line-cap': 'butt',
  'line-join': 'miter',
  'line-miter-limit' : 2,
  'line-width': 1,
  'text-anchor': 'center',
  'text-color': '#000000',
  'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
  'text-halo-color': 'rgba(0, 0, 0, 0)',
  'text-halo-width': 0,
  'text-max-width': 10,
  'text-offset': [0, 0],
  'text-size': 16,
  'icon-opacity': 1,
  'icon-rotate': 0,
  'icon-size': 1
};

function applyDefaults(properties) {
  for (var property in defaults) {
    if (!(property in properties)) {
      properties[property] = defaults[property];
    }
  }
}

function applyLayoutToPaint(layer) {
  for (var property in layer.layout) {
    if (!layer.paint[property]) {
      layer.paint[property] = layer.layout[property];
    }
  }
}

function convertToFunctions(properties, type) {
  for (var i = 0, ii = functions[type].length; i < ii; ++i) {
    var property = functions[type][i];
    properties[property] = glfun[type](properties[property]);
  }
}

var fontMap = {};

function chooseFont(properties, onChange) {
  if (properties['text-field']) {
    var fonts = properties['text-font'];
    var fontData = fontMap[fonts];
    if (!fontData) {
      fontData = fontMap[fonts] = {
        css: mb2css.parseFont(fonts[fonts.length - 1])
      };
    }
    var fontIndex = fontData.checking ? fonts.indexOf(fontData.checking) : 0;
    var css = fontData.css;
    if (!(fontData.checking || fontData.font)) {
      fontData.checking = fonts[fontIndex];
      css = mb2css.parseFont(fonts[fontIndex]);
      new FontFaceObserver(css[3], {
        weight: css[1],
        style: css[0]
      }).load().then(function() {
        fontData.css = css;
        fontData.font = fontData.checking;
        delete fontData.checking;
        onChange();
      }, function() {
        // Font is not available, try next
        ++fontIndex;
        if (fontIndex < fonts.length) {
          fontData.checking = fonts[fontIndex];
          chooseFont(properties, onChange);
          onChange();
        }
      });
    }
  }
}

function preprocess(layer, onChange) {
  if (!layer.paint) {
    layer.paint = {};
  }
  if (!layer.ref) {
    applyLayoutToPaint(layer);
  }
  applyDefaults(layer.paint);
  convertToFunctions(layer.paint, 'interpolated');
  convertToFunctions(layer.paint, 'piecewise-constant');
  chooseFont(layer.paint, onChange);
}

function resolveRef(layer, glStyleObj) {
  if (layer.ref) {
    var layers = glStyleObj.layers;
    for (var i = 0, ii = layers.length; i < ii; ++i) {
      var refLayer = layers[i];
      if (refLayer.id == layer.ref) {
        layer.type = refLayer.type;
        layer.source = refLayer.source;
        layer['source-layer'] = refLayer['source-layer'];
        layer.minzoom = refLayer.minzoom;
        layer.maxzoom = refLayer.maxzoom;
        layer.filter = refLayer.filter;
        layer.layout = refLayer.layout;
        return;
      }
    }
  }
}

function evaluate(filterObj, properties) {
  var type = filterObj[0];
  var i, ii;
  if (type == '==') {
    return properties[filterObj[1]] === filterObj[2];
  } else if (type == '!=') {
    return properties[filterObj[1]] !== filterObj[2];
  } else if (type == '>') {
    return properties[filterObj[1]] > filterObj[2];
  } else if (type == '<') {
    return properties[filterObj[1]] < filterObj[2];
  } else if (type == '>=') {
    return properties[filterObj[1]] >= filterObj[2];
  } else if (type == '<=') {
    return properties[filterObj[1]] <= filterObj[2];
  } else if (type == 'in' || type == '!in') {
    var result = false;
    var property = properties[filterObj[1]];
    for (i = 2, ii = filterObj.length; i < ii; ++i) {
      result = result || property == filterObj[i];
    }
    return type == 'in' ? result : !result;
  } else if (type == 'all') {
    for (i = 1, ii = filterObj.length; i < ii; ++i) {
      if (!evaluate(filterObj[i], properties)) {
        return false;
      }
    }
    return true;
  } else if (type == 'any') {
    for (i = 1, ii = filterObj.length; i < ii; ++i) {
      if (evaluate(filterObj[i], properties)) {
        return true;
      }
    }
    return false;
  } else if (type == 'none') {
    for (i = 1, ii = filterObj.length; i < ii; ++i) {
      if (evaluate(filterObj[i], properties)) {
        return false;
      }
    }
    return true;
  }
}

function getZoomForResolution(resolution, resolutions) {
  var candidate;
  var i = 0, ii = resolutions.length;
  for (; i < ii; ++i) {
    candidate = resolutions[i];
    if (candidate < resolutions && i + 1 < ii) {
      var zoomFactor = resolutions[i] / resolutions[i + 1];
      return Math.log(resolutions[i] / resolution) / Math.log(zoomFactor);
    }
  }
  return resolutions[ii - 1];
}

function colorWithOpacity(color, opacity) {
  if (color && opacity !== undefined) {
    color = colorToArray(color);
    color[3] *= opacity;
    if (color[3] === 0) {
      color = undefined;
    }
  }
  return color;
}

function deg2rad(degrees) {
  return degrees * Math.PI / 180;
}

var spriteRegEx = /^(.*)(\?access_token=.*)$/;

function toSpriteUrl(url, extension) {
  var parts = url.match(spriteRegEx);
  return parts ?
      parts[1] + extension + (parts.length > 2 ? parts[2] : '') :
      url + extension;
}

var templateRegEx = /^(.*)\{(.*)\}(.*)$/;

function fromTemplate(text, properties) {
  var parts = text.match(templateRegEx);
  if (parts) {
    var value = properties[parts[2]] || '';
    return parts[1] + value + parts[3];
  } else {
    return text;
  }
}


/**
 * Creates a style function from the `glStyle` object for all layers that use
 * the specified `source`, which needs to be a `"type": "vector"`
 * source.
 *
 * @param {string|Object} glStyle Mapbox GL style object.
 * @param {string} source `source` key from the Mapbox GL style object.
 * @param {Array<number>} resolutions Resolutions for mapping resolution to
 * zoom level. For tile layers, this can be
 * `layer.getSource().getTileGrid().getResolutions()`.
 * @param {Function} onChange Callback which will be called when the style is
 * ready to use for rendering, and every time a new resource (e.g. icon sprite
 * or font) is ready to be applied.
 * @return {ol.style.StyleFunction} Style function for use in
 * `ol.layer.Vector` or `ol.layer.VectorTile`.
 */
function getStyleFunction(glStyle, source, resolutions, onChange) {
  if (typeof glStyle == 'object') {
    // We do not want to modify the original, so we deep-clone it
    glStyle = JSON.stringify(glStyle);
  }
  glStyle = JSON.parse(glStyle);
  if (glStyle.version != 8) {
    throw new Error('glStyle version 8 required.');
  }
  var spriteData;
  var spriteImage;
  var spriteImageSize;
  var spriteScale;
  if (glStyle.sprite) {
    spriteScale = ol.has.DEVICE_PIXEL_RATIO >= 1.5 ? 0.5 : 1;
    var xhr = new window.XMLHttpRequest();
    var sizeFactor = spriteScale == 0.5 ? '@2x' : '';
    var spriteUrl = toSpriteUrl(glStyle.sprite, sizeFactor + '.json');
    xhr.open('GET', spriteUrl);
    xhr.onload = xhr.onerror = function() {
      if (!xhr.responseText) {
        throw new Error('Sprites cannot be loaded from ' + spriteUrl);
      }
      spriteData = JSON.parse(xhr.responseText);
      onChange();
    };
    xhr.send();
    var spriteImageUrl = toSpriteUrl(glStyle.sprite, sizeFactor + '.png');
    spriteImage = document.createElement('IMG');
    spriteImage.onload = function() {
      spriteImageSize = [spriteImage.width, spriteImage.height];
      onChange();
    };
    spriteImage.src = spriteImageUrl;
  } else {
    window.setTimeout(onChange, 0);
  }

  var ctx = document.createElement('CANVAS').getContext('2d');
  var measureCache = {};
  function wrapText(text, font, em) {
    var key = em + font + text;
    var wrappedText = measureCache[key];
    if (!wrappedText) {
      ctx.font = font;
      var oneEm = ctx.measureText('M').width;
      var width = oneEm * em;
      var words = text.split(' ');
      var line = '';
      var lines = [];
      for (var i = 0, ii = words.length; i < ii; ++i) {
        var word = words[i];
        if ((ctx.measureText(line + word).width <= width)) {
          line += (line ? ' ' : '') + word;
        } else {
          lines.push(line);
          line = word;
        }
      }
      if (line) {
        lines.push(line);
      }
      wrappedText = measureCache[key] = lines.join('\n');
    }
    return wrappedText;
  }

  var allLayers = glStyle.layers;
  var layers = [];
  for (var i = 0, ii = allLayers.length; i < ii; ++i) {
    var layer = allLayers[i];
    if (!layer.layout) {
      layer.layout = {};
    }
    resolveRef(layer, glStyle);
    if (layer.source == source) {
      layers.push(layer);
      preprocess(layer, onChange);
    }
  }

  var textHalo = new ol.style.Stroke();
  var textColor = new ol.style.Fill();

  var iconImageCache = {};

  var styles = [];

  return function(feature, resolution) {
    var zoom = resolutions.indexOf(resolution);
    if (zoom == -1) {
      zoom = getZoomForResolution(resolution, resolutions);
    }
    var properties = feature.getProperties();
    properties['$type'] = feature.getGeometry().getType().replace('Multi', '');
    var stylesLength = -1;
    var color, opacity, fill, layer, stroke, strokeColor, style, text;
    for (var i = 0, ii = layers.length; i < ii; ++i) {
      layer = layers[i];
      if ((layer['source-layer'] && layer['source-layer'] != properties.layer) ||
          ('minzoom' in layer && zoom < layer.minzoom) ||
          ('maxzoom' in layer && zoom > layer.maxzoom)) {
        continue;
      }
      if (!layer.filter || evaluate(layer.filter, properties)) {
        var paint = layer.paint;
        var type = properties['$type'];

        if (type == 'Polygon') {
          opacity = paint['fill-opacity'](zoom);
          color = colorWithOpacity(paint['fill-color'](zoom), opacity);
          strokeColor = colorWithOpacity(paint['fill-outline-color'](zoom), opacity);
          if (color) {
            ++stylesLength;
            style = styles[stylesLength];
            if (!style || !style.getFill() || style.getStroke() || style.getText()) {
              style = styles[stylesLength] = new ol.style.Style({
                fill: new ol.style.Fill()
              });
            }
            fill = style.getFill();
            fill.setColor(color);
            style.setZIndex(i);
          }
          if (strokeColor) {
            ++stylesLength;
            style = styles[stylesLength];
            if (!style || !style.getStroke() || style.getFill() || style.getText()) {
              style = styles[stylesLength] = new ol.style.Style({
                stroke: new ol.style.Stroke()
              });
            }
            stroke = style.getStroke();
            stroke.setLineCap(defaults['line-cap']);
            stroke.setLineJoin(defaults['line-join']);
            stroke.setMiterLimit(defaults['line-miter-limit']);
            stroke.setColor(strokeColor);
            stroke.setWidth(1);
            stroke.setLineDash(null);
            style.setZIndex(i);
          }
        } else if (type == 'LineString') {
          color = colorWithOpacity(
              paint['line-color'](zoom), paint['line-opacity'](zoom));
          var width = paint['line-width'](zoom);
          if (color && width > 0) {
            ++stylesLength;
            style = styles[stylesLength];
            if (!style || !style.getStroke() || style.getFill() || style.getText()) {
              style = styles[stylesLength] = new ol.style.Style({
                stroke: new ol.style.Stroke()
              });
            }
            stroke = style.getStroke();
            stroke.setLineCap(paint['line-cap']);
            stroke.setLineJoin(paint['line-join']);
            stroke.setMiterLimit(paint['line-miter-limit'](zoom));
            stroke.setColor(color);
            stroke.setWidth(width);
            stroke.setLineDash(paint['line-dasharray'] ?
                paint['line-dasharray'].map(function(x) {
                  return x * width * ol.has.DEVICE_PIXEL_RATIO;
                }) : null);
            style.setZIndex(i);
          }
        }

        var icon;
        var iconImage = paint['icon-image'];
        if (type == 'Point' && iconImage) {
          ++stylesLength;
          icon = fromTemplate(iconImage, properties);
          style = iconImageCache[icon];
          if (!style && spriteData && spriteImageSize) {
            var spriteImageData = spriteData[icon];
            style = iconImageCache[icon] = new ol.style.Style({
              image: new ol.style.Icon({
                img: spriteImage,
                size: [spriteImageData.width, spriteImageData.height],
                imgSize: spriteImageSize,
                offset: [spriteImageData.x, spriteImageData.y],
                scale: paint['icon-size'](zoom) * spriteScale
              })
            });
          }
          if (style) {
            var iconImg = style.getImage();
            iconImg.setRotation(deg2rad(paint['icon-rotate'](zoom)));
            iconImg.setOpacity(paint['icon-opacity'](zoom));
            style.setZIndex(i);
            styles[stylesLength] = style;
          }
        }

        var label;
        var textField = paint['text-field'];
        if (textField) {
          label = fromTemplate(textField, properties);
        }
        // TODO Add LineString handling as soon as it's supporte in OpenLayers
        if (label && type !== 'LineString') {
          ++stylesLength;
          style = styles[stylesLength];
          if (!style || !style.getText() || style.getFill() || style.getStroke()) {
            style = styles[stylesLength] = new ol.style.Style({
              text: new ol.style.Text({
                text: '',
                fill: textColor
              })
            });
          }
          text = style.getText();
          var textSize = paint['text-size'](zoom);
          var font = mb2css.asCss(fontMap[paint['text-font']].css, textSize);
          var textTransform = paint['text-transform'];
          if (textTransform == 'uppercase') {
            label = label.toUpperCase();
          } else if (textTransform == 'lowercase') {
            label = label.toLowerCase();
          }
          var wrappedLabel = wrapText(label, font, paint['text-max-width']);
          text.setText(wrappedLabel);
          text.setFont(font);
          var offset = paint['text-offset'](zoom);
          var yOffset = offset[1] * textSize + (wrappedLabel.split('\n').length - 1) * textSize;
          var anchor = paint['text-anchor'];
          if (anchor.indexOf('top') == 0) {
            yOffset += 0.5 * textSize;
          } else if (anchor.indexOf('bottom') == 0) {
            yOffset -= 0.5 * textSize;
          }
          text.setOffsetX(offset[0] * textSize);
          text.setOffsetY(yOffset);
          text.getFill().setColor(paint['text-color']);
          if (paint['text-halo-width']) {
            textHalo.setWidth(paint['text-halo-width']);
            textHalo.setColor(paint['text-halo-color']);
            text.setStroke(textHalo);
          } else {
            text.setStroke(undefined);
          }
          style.setZIndex(i);
        }
      }
    }

    if (stylesLength > -1) {
      styles.length = stylesLength + 1;
      return styles;
    }
  };
}

/**
 * Applies a style function to an `ol.layer.VectorTile` with an
 * `ol.source.VectorTile`. The style function will render all layers from the
 * `glStyle` object that use the specified `source`, which needs to be a
 * `"type": "vector"` source.
 *
 * @param {ol.layer.VectorTile} layer OpenLayers layer.
 * @param {string|Object} glStyle Mapbox GL style object.
 * @param {string} source `source` key from the Mapbox GL style object.
 * @return {Promise} Promise which will be resolved when the style can be used
 * for rendering.
 */
function applyStyle(layer, glStyle, source) {
  return new Promise(function(resolve, reject) {
    var resolutions = layer.getSource().getTileGrid().getResolutions();
    var style;
    var resolved = false;
    function onChange() {
      layer.setStyle(style);
      if (!resolved) {
        resolve();
        resolved = true;
      }
    }
    try {
      style = getStyleFunction(glStyle, source, resolutions, onChange);
    } catch (e) {
      window.setTimeout(function() {
        reject(e);
      }, 0);
    }
  });
}

module.exports = {
  applyStyle: applyStyle,
  getStyleFunction: getStyleFunction
};
