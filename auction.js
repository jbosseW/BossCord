// auction.js — Auction House / Marketplace for BossCord
// Players list items and TCG cards for sale, others can buy

const crypto = require('crypto');

const MAX_LISTINGS_PER_ACCOUNT = 20;
const MAX_ACTIVE_LISTINGS = 500; // global cap
const LISTING_FEE_PERCENT = 5; // 5% listing fee on sale
const LISTING_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

class AuctionHouse {
  constructor() {
    this.listings = new Map(); // Map<listingId, listing>
    this.nextId = 1;
  }

  /**
   * Create a new listing.
   * @param {string} sellerKey - account key
   * @param {string} sellerName - display name
   * @param {string} sellerColor - name color
   * @param {string} itemType - 'item' or 'card'
   * @param {string} instanceId - instance ID of the item/card
   * @param {object} itemInfo - { id, name, rarity, type, img?, icon?, atk?, def?, hp?, rarityColor }
   * @param {number} price - asking price in chips
   */
  createListing(sellerKey, sellerName, sellerColor, itemType, instanceId, itemInfo, price) {
    if (!sellerKey || !instanceId || !itemInfo || !price) return { error: 'Missing data' };
    price = Math.floor(price);
    if (price < 1 || price > 100000) return { error: 'Price must be 1-100,000 chips' };
    if (itemType !== 'item' && itemType !== 'card') return { error: 'Invalid item type' };
    if (this.listings.size >= MAX_ACTIVE_LISTINGS) return { error: 'Marketplace is full' };

    // Check seller listing cap
    let sellerCount = 0;
    for (const [, listing] of this.listings) {
      if (listing.sellerKey === sellerKey) sellerCount++;
    }
    if (sellerCount >= MAX_LISTINGS_PER_ACCOUNT) return { error: 'Too many active listings (max ' + MAX_LISTINGS_PER_ACCOUNT + ')' };

    // Check for duplicate
    for (const [, listing] of this.listings) {
      if (listing.instanceId === instanceId && listing.sellerKey === sellerKey) {
        return { error: 'This item is already listed' };
      }
    }

    const id = 'AH' + (this.nextId++);
    const listing = {
      id,
      sellerKey,
      sellerName: sellerName || 'Anon',
      sellerColor: sellerColor || '#dcddde',
      itemType,
      instanceId,
      itemInfo: {
        id: itemInfo.id,
        name: itemInfo.name,
        rarity: itemInfo.rarity,
        type: itemInfo.type,
        img: itemInfo.img || null,
        icon: itemInfo.icon || null,
        text: itemInfo.text || null,
        atk: itemInfo.atk || null,
        def: itemInfo.def || null,
        hp: itemInfo.hp || null,
        rarityColor: itemInfo.rarityColor || '#9e9e9e',
        coinValue: itemInfo.coinValue || itemInfo.sellValue || 0,
      },
      price,
      listedAt: Date.now(),
      expiresAt: Date.now() + LISTING_EXPIRY_MS,
    };

    this.listings.set(id, listing);
    return listing;
  }

  /**
   * Cancel a listing (by seller).
   */
  cancelListing(listingId, accountKey) {
    const listing = this.listings.get(listingId);
    if (!listing) return { error: 'Listing not found' };
    if (listing.sellerKey !== accountKey) return { error: 'Not your listing' };
    this.listings.delete(listingId);
    return { success: true, listing };
  }

  /**
   * Buy a listing.
   * Returns the listing info so the caller can transfer the item and chips.
   */
  buyListing(listingId, buyerKey, buyerBalance) {
    const listing = this.listings.get(listingId);
    if (!listing) return { error: 'Listing not found' };
    if (listing.sellerKey === buyerKey) return { error: 'Cannot buy your own listing' };
    if (Date.now() > listing.expiresAt) {
      this.listings.delete(listingId);
      return { error: 'Listing expired' };
    }

    // Balance check: verify buyer can afford before removing listing
    if (typeof buyerBalance === 'number' && buyerBalance < listing.price) {
      return { error: 'Insufficient chips' };
    }

    this.listings.delete(listingId);
    const fee = Math.ceil(listing.price * LISTING_FEE_PERCENT / 100);
    const sellerProceeds = listing.price - fee;

    return {
      success: true,
      listing,
      price: listing.price,
      fee,
      sellerProceeds,
    };
  }

  /**
   * Get all active listings, optionally filtered.
   */
  getListings(filters) {
    const now = Date.now();
    const results = [];

    for (const [, listing] of this.listings) {
      // Remove expired
      if (now > listing.expiresAt) {
        this.listings.delete(listing.id);
        continue;
      }

      // Apply filters
      if (filters) {
        if (filters.itemType && listing.itemType !== filters.itemType) continue;
        if (filters.rarity && listing.itemInfo.rarity !== filters.rarity) continue;
        if (filters.type && listing.itemInfo.type !== filters.type) continue;
        if (filters.search) {
          const s = filters.search.toLowerCase();
          if (!listing.itemInfo.name.toLowerCase().includes(s)) continue;
        }
        if (filters.sellerKey && listing.sellerKey !== filters.sellerKey) continue;
      }

      results.push({
        id: listing.id,
        sellerName: listing.sellerName,
        sellerColor: listing.sellerColor,
        itemType: listing.itemType,
        itemInfo: listing.itemInfo,
        price: listing.price,
        listedAt: listing.listedAt,
        expiresAt: listing.expiresAt,
        isOwn: filters && filters.viewerKey === listing.sellerKey,
      });
    }

    // Sort by newest first, or by price
    const sortBy = (filters && filters.sortBy) || 'newest';
    if (sortBy === 'price_low') results.sort((a, b) => a.price - b.price);
    else if (sortBy === 'price_high') results.sort((a, b) => b.price - a.price);
    else results.sort((a, b) => b.listedAt - a.listedAt);

    return results;
  }

  /**
   * Get listing count for an account.
   */
  getSellerListingCount(accountKey) {
    let count = 0;
    for (const [, listing] of this.listings) {
      if (listing.sellerKey === accountKey) count++;
    }
    return count;
  }

  /**
   * Cleanup expired listings and return items.
   * Returns array of expired listings for item recovery.
   */
  cleanupExpired() {
    const now = Date.now();
    const expired = [];
    for (const [id, listing] of this.listings) {
      if (now > listing.expiresAt) {
        expired.push(listing);
        this.listings.delete(id);
      }
    }
    return expired;
  }
}

module.exports = { AuctionHouse, MAX_LISTINGS_PER_ACCOUNT, LISTING_FEE_PERCENT, LISTING_EXPIRY_MS };
