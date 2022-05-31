import { Collection, Db, Filter, MongoClient } from "mongodb";
import { logger } from "./logging";

export class Database {
  protected db?: Db;
  protected client: MongoClient;
  protected collectionCache: Record<string, Collection<any>> = {};
  constructor(db_conn: string) {
    this.client = new MongoClient(db_conn);
  }

  async initDB(db_name: string) {
    await this.client.connect();
    this.db = this.client.db(db_name);
    logger.info(`Successfully connected to database: ${this.db.databaseName}`);
  }

  async load<T>(filter: Filter<T>, name: string) {
    const collection = this.getCollection<T>(name);
    // load from collection
    const item = (await collection.findOne(filter)) as unknown as T;
    return item;
  }

  async loadMany<T>(filter: Filter<T>, name: string) {
    const collection = this.getCollection<T>(name);
    // load from collection
    const cursor = await collection.find(filter);
    const item = (await cursor.toArray()) as unknown as T[];
    return item;
  }

  public getCollection<T>(name: string) {
    let collection: Collection<T>;
    if (name in this.collectionCache) {
      collection = this.collectionCache[name];
    } else {
      if (!this.db) {
        throw new Error(`db is not initialized`);
      }
      collection = this.db.collection<T>(name);
      // cache it
      this.collectionCache[name] = collection;
      logger.info(
        `Successfully connected to collection: ${collection.collectionName}`
      );
    }
    return collection;
  }

  async save<T extends { id: string }>(item: T, name: string) {
    const collection = this.getCollection(name);
    const result = await collection.updateOne(
      { id: item.id },
      { $set: item },
      { upsert: true }
    );
    if (result) {
      logger.info(`${name} id of ${item.id} is successfully saved!`);
      return result.upsertedId;
    }
    return null;
  }

  async saveMany<T>(items: T[], name: string) {
    const collection = this.getCollection(name);
    const result = await collection.insertMany(items);
    if (result) {
      logger.info(`${items.length} number of ${name} successfully saved!`);
      return result.insertedIds;
    }
    return null;
  }

  async deleteMany<T>(filter: Filter<T>, name: string) {
    const collection = this.getCollection<T>(name);
    const result = await collection.deleteMany(filter);
    if (result) {
      logger.info(
        `${result.deletedCount} number of ${name} successfully deleted!`
      );
      return result.deletedCount;
    }
    return null;
  }

  async close() {
    return this.client.close();
  }
}
